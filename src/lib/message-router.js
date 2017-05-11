'use strict'

const co = require('co')
const IlpPacket = require('ilp-packet')
const InvalidBodyError = require('five-bells-shared').InvalidBodyError
const IlpError = require('../errors/ilp-error')
const validate = require('./validate').validate
const log = require('../common/log').create('message-router')

const PEER_LEDGER_PREFIX = 'peer.'

/**
 * @param {Object} opts
 * @param {Config} opts.config
 * @param {Ledgers} opts.ledgers
 * @param {RoutingTables} opts.routingTables
 * @param {RouteBroadcaster} opts.routeBroadcaster
 * @param {RouteBuilder} opts.routeBuilder
 * @param {BalanceCache} opts.balanceCache
 */
function MessageRouter (opts) {
  this.config = opts.config
  this.ledgers = opts.ledgers
  this.routingTables = opts.routingTables
  this.routeBroadcaster = opts.routeBroadcaster
  this.routeBuilder = opts.routeBuilder
  this.balanceCache = opts.balanceCache
  this.ledgers.registerInternalRequestHandler(this.handleRequest.bind(this))
}

/**
 * Process an incoming message, and send a response message (if applicable) back to the sender.
 *
 * @param {RequestMessage} requestMessage
 * @returns {Promise.<ResponseMessage>}
 */
MessageRouter.prototype.handleRequest = function (requestMessage) {
  if (!requestMessage.ilp && !requestMessage.custom) {
    return Promise.reject(new Error('Invalid request message'))
  }
  return co.wrap(this._handleRequest).call(this, requestMessage).catch((err) => {
    if (!(err instanceof IlpError)) throw err
    return {
      ledger: requestMessage.ledger,
      from: requestMessage.to,
      to: requestMessage.from,
      ilp: IlpPacket.serializeIlpError(Object.assign({}, err.packet, {
        forwardedBy: err.packet.forwardedBy.concat(requestMessage.to)
      }))
    }
  })
}

/**
 * @param {RequestMessage} request
 * @returns {ResponseMessage} response
 */
MessageRouter.prototype._handleRequest = function * (request) {
  if (request.ilp) {
    const responsePacket = yield this._handleRequestByPacket(
      Buffer.from(request.ilp, 'base64'), request.from)
    return {
      ledger: request.ledger,
      from: request.to,
      to: request.from,
      ilp: responsePacket.toString('base64')
    }
  }

  if (request.custom.method === 'broadcast_routes') {
    yield this.receiveRoutes(request.custom.data, request.from)
    return {
      ledger: request.ledger,
      from: request.to,
      to: request.from
    }
  }

  log.warn('ignoring unkown request method', request.custom.method)
}

MessageRouter.prototype._handleRequestByPacket = function * (packet, sender) {
  const params = {sourceAccount: sender}
  switch (packet[0]) {
    case IlpPacket.Type.TYPE_ILQP_BY_SOURCE_REQUEST:
      return IlpPacket.serializeIlqpBySourceResponse(
        yield this.routeBuilder.quoteBySource(
          Object.assign(params, IlpPacket.deserializeIlqpBySourceRequest(packet))))
    case IlpPacket.Type.TYPE_ILQP_BY_DESTINATION_REQUEST:
      return IlpPacket.serializeIlqpByDestinationResponse(
        yield this.routeBuilder.quoteByDestination(
          Object.assign(params, IlpPacket.deserializeIlqpByDestinationRequest(packet))))
    default:
      throw new InvalidBodyError('Packet has unexpected type')
  }
}

/**
 * Add routes to the local routing table.
 *
 * @param {Route[]} routes
 * @param {IlpAddress} sender
 */
MessageRouter.prototype.receiveRoutes = function * (payload, sender) {
  validate('RoutingUpdate', payload)
  log.debug('receiveRoutes sender:', sender)
  let routes = payload.new_routes

  let holdDownTime = payload.hold_down_time
  this.routingTables.bumpConnector(sender, holdDownTime)
  let potentiallyUnreachableLedgers = payload.unreachable_through_me
  let lostLedgerLinks = []
  if (potentiallyUnreachableLedgers.length > 0) {
    log.info('informed of broken routes to:', potentiallyUnreachableLedgers, ' through:', sender)
    for (const ledger of potentiallyUnreachableLedgers) {
      lostLedgerLinks.push(...this.routingTables.invalidateConnectorsRoutesTo(sender, ledger))
    }
  }

  if (routes.length === 0 && lostLedgerLinks.length === 0) { // just a heartbeat
    log.info('got heartbeat from:', sender)
    return
  }

  let gotNewRoute = false
  for (const route of routes) {
    // We received a route from another connector, but that route
    // doesn't actually belong to the connector, so ignore it.
    if (route.source_account !== sender) continue
    // make sure source_account is on source_ledger:
    if (!route.source_account.startsWith(route.source_ledger)) continue
    // The destination_ledger can be any ledger except one that starts with `peer.`.
    if (route.destination_ledger.startsWith(PEER_LEDGER_PREFIX)) continue
    if (this.routingTables.addRoute(route)) gotNewRoute = true
  }
  log.debug('receiveRoutes sender:', sender, ' provided ', routes.length, ' any new?:', gotNewRoute)

  if ((gotNewRoute || (lostLedgerLinks.length > 0)) &&
      this.config.routeBroadcastEnabled) {
    this.routeBroadcaster.markLedgersUnreachable(lostLedgerLinks)
    co(this.routeBroadcaster.broadcast.bind(this.routeBroadcaster))
      .catch(function (err) {
        log.warn('error broadcasting routes: ' + err.message)
      })
  }
}

module.exports = MessageRouter
