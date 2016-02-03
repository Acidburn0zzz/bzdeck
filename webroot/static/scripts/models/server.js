/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Initialize the Server Model that represents a remote Bugzilla instance. Available through the ServerCollection.
 * @extends BzDeck.BaseModel
 */
BzDeck.ServerModel = class ServerModel extends BzDeck.BaseModel {
  /**
   * Get an BugModel instance.
   * @constructor
   * @argument {Object} data - Server data.
   * @return {Proxy} bug - New ServerModel instance.
   */
  constructor (data) {
    super(); // This does nothing but is required before using `this`

    this.datasource = BzDeck.datasources.global;
    this.store_name = 'bugzilla';
    this.data = data;
    this.name = data.host;

    let config = BzDeck.config.servers[this.name];

    // Extract the local config for easier access
    for (let [key, value] of Object.entries(config)) {
      this[key] = value;
    }
  }

  /**
   * Get the Bugzilla configuration from cache. If it's not cached yet or older than 24 hours, retrieve the current
   * config from the remote Bugzilla instance. The config is not yet available from the REST endpoint so use the BzAPI
   * compat layer instead.
   * @argument {undefined}
   * @return {Promise.<Object>} config - Promise to be resolved in the Bugzilla configuration data.
   * @see {@link https://wiki.mozilla.org/Bugzilla:BzAPI:Methods#Other}
   * @see {@link https://bugzilla.mozilla.org/show_bug.cgi?id=504937}
   */
  get_config () {
    if (!navigator.onLine) {
      // Offline; give up
      return Promise.reject(new Error('You have to go online to load data.')); // l10n
    }

    if (this.data.config && new Date(this.data.config_retrieved || 0) > Date.now() - 1000 * 60 * 60 * 24) {
      // The config data is still fresh, retrieved within 24 hours
      return Promise.resolve(this.data.config);
    }

    // Fetch the config via BzAPI
    return fetch(`${this.url}${this.endpoints.bzapi}configuration?cached_ok=1`).then(response => {
      return response.json();
    }).then(config => {
      if (config && config.version) {
        let config_retrieved = this.data.config_retrieved = Date.now();

        this.data.config = config;
        this.datasource.get_store(this.store_name).save({ host: this.name, config, config_retrieved });

        return Promise.resolve(config);
      }

      return Promise.reject(new Error('Bugzilla configuration could not be loaded. The retrieved data is collapsed.'));
    }).catch(error => {
      return Promise.reject(new Error('Bugzilla configuration could not be loaded. The instance might be offline.'));
    });
  }

  /**
   * Send an API request to the remote Bugzilla instance. Use a Worker on a different thread.
   * @argument {String} path - Location including an API method.
   * @argument {URLSearchParams} [params] - Search query.
   * @argument {Object} [options] - Extra options.
   * @argument {String} [options.method='GET'] - Request method.
   * @argument {Object} [options.data] - Post data.
   * @argument {String} [options.api_key] - API key used to authenticate against the Bugzilla API.
   * @argument {Object.<String, Function>} [options.listeners] - Event listeners. The key is an event type like 'load',
   *  the value is the handler. If the type is 'progress' and the post data is set, it will called during the upload.
   * @return {Promise.<Object>} response - Promise to be resolved in the raw bug object retrieved from Bugzilla.
   * @see {@link http://bugzilla.readthedocs.org/en/latest/api/core/v1/}
   */
  request (path, params, options = {}) {
    if (!navigator.onLine) {
      return Promise.reject(new Error('You have to go online to load data.')); // l10n
    }

    let xhr = new XMLHttpRequest(),
        url = new URL(this.url + this.endpoints.rest + path),
        method = options.method || (options.data ? 'POST' : 'GET'),
        headers = new Map(),
        data = options.data ? Object.assign({}, options.data) : undefined, // Avoid DataCloneError by postMessage
        listeners = options.listeners || {};

    if (params) {
      url.search = params.toString();
    }

    headers.set('Accept', 'application/json');
    headers.set('X-Bugzilla-API-Key', options.api_key || BzDeck.account.data.api_key);

    return new Promise((resolve, reject) => {
      let post = event => {
        let type = event.type,
            result = { type };

        if (type === 'abort') {
          reject(new Error('Connection aborted.'));
        }

        if (type === 'error') {
          reject(new Error('Connection error.'));
        }

        if (type === 'load') {
          result.response = event.target.response;

          try {
            resolve(JSON.parse(event.target.response));
          } catch (ex) {
            reject(new Error('Data not found or not valid in the response.'));
          }
        }

        if (type === 'progress') {
          result.total = event.total;
          result.loaded = event.loaded;
          result.lengthComputable = event.lengthComputable;
        }

        if (type in listeners) {
          listeners[type](result);
        }
      };

      xhr.open(method || 'GET', url.toString());
      headers.forEach((value, key) => xhr.setRequestHeader(key, value));
      xhr.addEventListener('abort', event => post(event));
      xhr.addEventListener('error', event => post(event));
      xhr.addEventListener('load', event => post(event));
      (data ? xhr.upload : xhr).addEventListener('progress', event => post(event));
      xhr.send(data ? JSON.stringify(data) : null);
    });
  }
}
