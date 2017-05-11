'use strict'

const EventEmitter = require('eventemitter2')

class MockPlugin extends EventEmitter {
  constructor (options) {
    super()
    this._prefix = options.prefix || 'example.'
    this._account = this._prefix + (options.username || 'mocky')
  }

  connect () {
    this.connected = true
    this.emit('connect')
    return Promise.resolve(null)
  }

  disconnect () {
    this.connected = false
    return Promise.resolve(null)
  }

  isConnected () {
    return this.connected
  }

  sendTransfer (transfer) {
    return Promise.resolve(null)
  }

  sendRequest (message) {
    return Promise.reject(new Error('MockPlugin.sendRequest is not implemented: ' + this._account))
  }

  fulfillCondition (transferId, conditionFulfillment) {
    if (conditionFulfillment === 'invalid') {
      return Promise.reject(new Error('invalid fulfillment'))
    }
    return Promise.resolve(null)
  }

  rejectIncomingTransfer (transferId, rejectionMessage) {
    return Promise.resolve(null)
  }

  getAccount () {
    return this._account
  }

  * _handleNotification () { }

  getBalance () {
    return Promise.resolve('123.456')
  }

  getInfo () {
    return {
      prefix: this._prefix,
      connectors: ['mark'],
      currencyCode: 'doesn\'t matter, the connector will ignore this',
      currencyScale: 4
    }
  }

  registerRequestHandler (requestHandler) { }
}

module.exports = MockPlugin
