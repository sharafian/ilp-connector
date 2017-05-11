'use strict'
const co = require('co')
const chai = require('chai')
const assert = chai.assert
const expect = chai.expect
chai.use(require('chai-as-promised'))

const appHelper = require('./helpers/app')
const mockRequire = require('mock-require')
const nock = require('nock')
nock.enableNetConnect(['localhost'])
const ratesResponse = require('./data/fxRates.json')
const logger = require('../src/common/log')
const logHelper = require('./helpers/log')
const _ = require('lodash')
const NoRouteFoundError = require('../src/errors/no-route-found-error')

const PluginMock = require('./mocks/mockPlugin')
mockRequire('ilp-plugin-mock', PluginMock)

describe('Modify Plugins', function () {
  logHelper(logger)

  beforeEach(function * () {
    appHelper.create(this)

    const testLedgers = ['cad-ledger.', 'usd-ledger.', 'eur-ledger.', 'cny-ledger.']
    _.map(testLedgers, (ledgerUri) => {
      this.ledgers.getPlugin(ledgerUri).getBalance =
        function () { return Promise.resolve('150000') }
    })

    // Reset before and after just in case a test wants to change the precision.
    this.balanceCache.reset()
    yield this.backend.connect(ratesResponse)
    yield this.ledgers.connect()
    yield this.routeBroadcaster.reloadLocalRoutes()
  })

  describe('addPlugin', function () {
    it('should add a new plugin to ledgers', function * () {
      assert.equal(Object.keys(this.ledgers._core.clients).length, 4)
      yield this.app.addPlugin('eur-ledger-2.', {
        currency: 'EUR',
        plugin: 'ilp-plugin-mock',
        options: {}
      })
      assert.equal(Object.keys(this.ledgers._core.clients).length, 5)
    })

    it('should support new ledger', function * () {
      const quotePromise = co(this.routeBuilder.quoteBySource({
        sourceAmount: '100',
        sourceAccount: 'eur-ledger-2.alice',
        destinationAccount: 'usd-ledger.bob',
        destinationHoldDuration: 5000
      }))

      yield assert.isRejected(quotePromise, NoRouteFoundError, /No route found from: eur-ledger-2\.alice to: usd-ledger\.bob/)

      yield this.app.addPlugin('eur-ledger-2.', {
        currency: 'EUR',
        plugin: 'ilp-plugin-mock',
        options: {}
      })

      const quotePromise2 = co(this.routeBuilder.quoteBySource({
        sourceAmount: '100',
        sourceAccount: 'eur-ledger-2.alice',
        destinationAccount: 'usd-ledger.bob',
        destinationHoldDuration: 5000
      }))

      yield assert.isFulfilled(quotePromise2)
    })

    it('should get peers on the added ledger', function * () {
      yield this.app.addPlugin('eur-ledger-2.', {
        currency: 'EUR',
        plugin: 'ilp-plugin-mock',
        options: {
          prefix: 'eur-ledger-2.'
        }
      })

      assert.isTrue(this.routeBroadcaster.peersByLedger['eur-ledger-2.']['mark'])
    })
  })

  describe('removePlugin', function () {
    beforeEach(function * () {
      yield this.app.addPlugin('eur-ledger-2.', {
        currency: 'EUR',
        plugin: 'ilp-plugin-mock',
        prefix: 'eur-ledger-2.',
        options: {
          prefix: 'eur-ledger-2.'
        }
      })
    })

    it('should remove a plugin from ledgers', function * () {
      assert.isOk(this.ledgers.getPlugin('eur-ledger-2.'))
      yield this.app.removePlugin('eur-ledger-2.')
      assert.isNotOk(this.ledgers.getPlugin('eur-ledger-2.'))
    })

    it('should no longer quote to that plugin', function * () {
      yield this.routeBuilder.quoteBySource({
        sourceAmount: '100',
        sourceAccount: 'eur-ledger-2.alice',
        destinationAccount: 'cad-ledger.bob',
        destinationHoldDuration: 1.001
      })

      yield this.app.removePlugin('eur-ledger-2.')

      yield co(this.routeBuilder.quoteBySource({
        sourceAmount: '100',
        sourceAccount: 'eur-ledger-2.alice',
        destinationAccount: 'usd-ledger.bob',
        destinationHoldDuration: 1.001
      })).then((quote) => {
        throw new Error()
      }).catch((err) => {
        expect(err.name).to.equal('NoRouteFoundError')
        expect(err.message).to.match(/No route found from: eur-ledger-2\.alice to: usd-ledger\.bob/)
      })
    })

    it('should depeer the removed ledger', function * () {
      yield this.app.removePlugin('eur-ledger-2.')

      assert.isNotOk(this.routeBroadcaster.peersByLedger['eur-ledger-2.'])
    })
  })
})
