//----------------------------------------------------------------------
// AdalJS v1.0.17
// @preserve Copyright (c) Microsoft Open Technologies, Inc.
// All Rights Reserved
// MIT
//
//----------------------------------------------------------------------

let Logging = {}

class ActiveDirectoryPlugin {
  /**
   * Configuration options for Authentication Context.
   * @class config
   *  @property {string} tenant - Your target tenant.
   *  @property {string} clientId - Client ID assigned to your app by Azure Active Directory.
   *  @property {string} redirectUri - Endpoint at which you expect to receive tokens.Defaults to `window.location.href`.
   *  @property {string} instance - Azure Active Directory Instance.Defaults to `https://login.microsoftonline.com/`.
   *  @property {Array} endpoints - Collection of {Endpoint-ResourceId} used for automatically attaching tokens in webApi calls.
   *  @property {Boolean} popUp - Set this to true to enable login in a popup winodow instead of a full redirect.Defaults to `false`.
   *  @property {string} localLoginUrl - Set this to redirect the user to a custom login page.
   *  @property {function} displayCall - User defined function of handling the navigation to Azure AD authorization endpoint in case of login. Defaults to 'null'.
   *  @property {string} postLogoutRedirectUri - Redirects the user to postLogoutRedirectUri after logout. Defaults is 'redirectUri'.
   *  @property {string} cacheLocation - Sets browser storage to either 'localStorage' or sessionStorage'. Defaults to 'sessionStorage'.
   *  @property {Array.<string>} anonymousEndpoints Array of keywords or URI's. Adal will not attach a token to outgoing requests that have these keywords or uri. Defaults to 'null'.
   *  @property {number} expireOffsetSeconds If the cached token is about to be expired in the expireOffsetSeconds (in seconds), Adal will renew the token instead of using the cached token. Defaults to 300 seconds.
   *  @property {string} correlationId Unique identifier used to map the request with the response. Defaults to RFC4122 version 4 guid (128 bits).
   *  @property {number} loadFrameTimeout The number of milliseconds of inactivity before a token renewal response from AAD should be considered timed out.
   */

  /**
   * Creates a new ActiveDirectoryPlugin object.
   * @constructor
   * @param {config}  config               Configuration options for ActiveDirectoryPlugin
   */

  constructor(config) {
    if (typeof window !== 'undefined') {
      Logging = {
        piiLoggingEnabled: true,
        level: 3,
        log: (message) => {
          console.log(message)
        },
      }
    }

    /**
     * Enum for request type
     * @enum {string}
     */
    this.REQUEST_TYPE = {
      LOGIN: 'LOGIN',
      RENEW_TOKEN: 'RENEW_TOKEN',
      UNKNOWN: 'UNKNOWN',
    }

    this.RESPONSE_TYPE = {
      ID_TOKEN_TOKEN: 'id_token token',
      TOKEN: 'token',
    }

    /**
     * Enum for storage constants
     * @enum {string}
     */
    this.CONSTANTS = {
      ACCESS_TOKEN: 'access_token',
      EXPIRES_IN: 'expires_in',
      ID_TOKEN: 'id_token',
      ERROR_DESCRIPTION: 'error_description',
      SESSION_STATE: 'session_state',
      ERROR: 'error',
      STORAGE: {
        TOKEN_KEYS: 'AD_TOKEN_KEYS',
        ACCESS_TOKEN_KEY: 'AD_ACCESS_TOKEN_KEY',
        EXPIRATION_KEY: 'AD_EXPIRATION_KEY',
        STATE_LOGIN: 'AD_STATE_LOGIN',
        STATE_RENEW: 'AD_STATE_RENEW',
        NONCE_IDTOKEN: 'AD_NONCE_IDTOKEN',
        SESSION_STATE: 'AD_SESSION_STATE',
        USERNAME: 'AD_USERNAME',
        IDTOKEN: 'AD_IDTOKEN',
        ERROR: 'AD_ERROR',
        ERROR_DESCRIPTION: 'AD_ERROR_DESCRIPTION',
        LOGIN_REQUEST: 'AD_LOGIN_REQUEST',
        LOGIN_ERROR: 'AD_LOGIN_ERROR',
        RENEW_STATUS: 'AD_TOKEN_RENEW_STATUS',
        ANGULAR_LOGIN_REQUEST: 'AD_ANGULAR_LOGIN_REQUEST',
      },
      RESOURCE_DELIMETER: '|',
      CACHE_DELIMETER: '||',
      LOADFRAME_TIMEOUT: 6000,
      TOKEN_RENEW_STATUS_CANCELED: 'Canceled',
      TOKEN_RENEW_STATUS_COMPLETED: 'Completed',
      TOKEN_RENEW_STATUS_IN_PROGRESS: 'In Progress',
      LOGGING_LEVEL: {
        ERROR: 0,
        WARN: 1,
        INFO: 2,
        VERBOSE: 3,
      },
      LEVEL_STRING_MAP: {
        0: 'ERROR:',
        1: 'WARNING:',
        2: 'INFO:',
        3: 'VERBOSE:',
      },
      POPUP_WIDTH: 483,
      POPUP_HEIGHT: 600,
      DEFAULT_EXPIRATION_TIME: 8640000,
    }

    // public
    this.instance = 'https://login.microsoftonline.com/'
    this.config = {}
    this.callback = null
    this.popUp = true

    // private
    this._user = null
    this._activeRenewals = {}
    this._loginInProgress = false
    this._acquireTokenInProgress = false
    this._renewStates = []
    this._callBackMappedToRenewStates = {}
    this._callBacksMappedToRenewStates = {}
    this._openedWindows = []
    this._requestType = this.REQUEST_TYPE.LOGIN
    window._adalInstance = this

    // validate before constructor assignments
    if (config.displayCall && typeof config.displayCall !== 'function') {
      throw new Error('displayCall is not a function')
    }

    if (!config.clientId) {
      throw new Error('clientId is required')
    }

    this.config = this._cloneConfig(config)

    if (this.config.navigateToLoginRequestUrl === undefined)
      this.config.navigateToLoginRequestUrl = true

    if (this.config.popUp) this.popUp = true

    if (this.config.callback && typeof this.config.callback === 'function')
      this.callback = this.config.callback

    if (this.config.instance) {
      this.instance = this.config.instance
    }

    // App can request idtoken for itself using clientid as resource
    if (!this.config.loginResource) {
      this.config.loginResource = this.config.clientId
    }

    // redirect and logout_redirect are set to current location by default
    if (!this.config.redirectUri) {
      // strip off query parameters or hashes from the redirect uri as AAD does not allow those.
      this.config.redirectUri = window.location.href.split('?')[0].split('#')[0]
    }

    if (!this.config.postLogoutRedirectUri) {
      // strip off query parameters or hashes from the post logout redirect uri as AAD does not allow those.
      this.config.postLogoutRedirectUri = window.location.href.split('?')[0].split('#')[0]
    }

    if (!this.config.anonymousEndpoints) {
      this.config.anonymousEndpoints = []
    }

    if (this.config.loadFrameTimeout) {
      this.CONSTANTS.LOADFRAME_TIMEOUT = this.config.loadFrameTimeout
    }
  }

  /**
   * Initiates the login process by redirecting the user to Azure AD authorization endpoint.
   */
  login() {
    if (this._loginInProgress) {
      this.info('Login in progress')
      return
    }

    this._loginInProgress = true

    // Token is not present and user needs to login
    const expectedState = this._guid()
    this.config.state = expectedState
    this._idTokenNonce = this._guid()
    let loginStartPage = this._getItem(this.CONSTANTS.STORAGE.ANGULAR_LOGIN_REQUEST)

    if (!loginStartPage || loginStartPage === '') {
      loginStartPage = window.location.href
    } else {
      this._saveItem(this.CONSTANTS.STORAGE.ANGULAR_LOGIN_REQUEST, '')
    }

    this.verbose('Expected state: ' + expectedState + ' startPage:' + loginStartPage)
    this._saveItem(this.CONSTANTS.STORAGE.LOGIN_REQUEST, loginStartPage)
    this._saveItem(this.CONSTANTS.STORAGE.LOGIN_ERROR, '')
    this._saveItem(this.CONSTANTS.STORAGE.STATE_LOGIN, expectedState, true)
    this._saveItem(this.CONSTANTS.STORAGE.NONCE_IDTOKEN, this._idTokenNonce, true)
    this._saveItem(this.CONSTANTS.STORAGE.ERROR, '')
    this._saveItem(this.CONSTANTS.STORAGE.ERROR_DESCRIPTION, '')
    const urlNavigate =
      this._getNavigateUrl('id_token', null) + '&nonce=' + encodeURIComponent(this._idTokenNonce)

    if (this.config.displayCall) {
      // User defined way of handling the navigation
      this.config.displayCall(urlNavigate)
    } else if (this.popUp) {
      this._saveItem(this.CONSTANTS.STORAGE.STATE_LOGIN, '') // so requestInfo does not match redirect case
      this._renewStates.push(expectedState)
      this.registerCallback(expectedState, this.config.clientId, this.callback)
      this._loginPopup(urlNavigate)
    } else {
      this.promptUser(urlNavigate)
    }
  }

  /**
   * Configures popup window for login.
   * @ignore
   */

  _openPopup(urlNavigate, title, popUpWidth, popUpHeight) {
    try {
      /**
       * adding winLeft and winTop to account for dual monitor
       * using screenLeft and screenTop for IE8 and earlier
       */
      const winLeft = window.screenLeft ? window.screenLeft : window.screenX
      const winTop = window.screenTop ? window.screenTop : window.screenY
      /**
       * window.innerWidth displays browser window's height and width excluding toolbars
       * using document.documentElement.clientWidth for IE8 and earlier
       */
      const width =
        window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth
      const height =
        window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight
      const left = width / 2 - popUpWidth / 2 + winLeft
      const top = height / 2 - popUpHeight / 2 + winTop

      const popupWindow = window.open(
        urlNavigate,
        title,
        'width=' + popUpWidth + ', height=' + popUpHeight + ', top=' + top + ', left=' + left,
      )

      if (popupWindow.focus) {
        popupWindow.focus()
      }

      return popupWindow
    } catch (e) {
      this.warn('Error opening popup, ' + e.message)
      this._loginInProgress = false
      this._acquireTokenInProgress = false
      return null
    }
  }

  _handlePopupError(loginCallback, resource, error, errorDesc, loginError) {
    this.warn(errorDesc)
    this._saveItem(this.CONSTANTS.STORAGE.ERROR, error)
    this._saveItem(this.CONSTANTS.STORAGE.ERROR_DESCRIPTION, errorDesc)
    this._saveItem(this.CONSTANTS.STORAGE.LOGIN_ERROR, loginError)

    if (resource && this._activeRenewals[resource]) {
      this._activeRenewals[resource] = null
    }

    this._loginInProgress = false
    this._acquireTokenInProgress = false

    if (loginCallback) {
      loginCallback(errorDesc, null, error)
    }
  }

  /**
   * After authorization, the user will be sent to your specified redirect_uri with the user's bearer token
   * attached to the URI fragment as an id_token field. It closes popup window after redirection.
   * @ignore
   */
  _loginPopup(urlNavigate, resource, callback) {
    const popupWindow = this._openPopup(
      urlNavigate,
      'login',
      this.CONSTANTS.POPUP_WIDTH,
      this.CONSTANTS.POPUP_HEIGHT,
    )
    const loginCallback = callback || this.callback

    if (popupWindow == null) {
      const error = 'Error opening popup'
      const errorDesc = 'Popup Window is null. This can happen if you are using IE'
      this._handlePopupError(loginCallback, resource, error, errorDesc, errorDesc)
      return
    }

    this._openedWindows.push(popupWindow)

    if (this.config.redirectUri.indexOf('#') != -1) {
      var registeredRedirectUri = this.config.redirectUri.split('#')[0]
    } else {
      var registeredRedirectUri = this.config.redirectUri
    }

    const that = this

    const pollTimer = window.setInterval(() => {
      if (!popupWindow || popupWindow.closed || popupWindow.closed === undefined) {
        const error = 'Popup Window closed'
        const errorDesc =
          'Popup Window closed by UI action/ Popup Window handle destroyed due to cross zone navigation in IE/Edge'

        that._handlePopupError(loginCallback, resource, error, errorDesc, errorDesc)
        window.clearInterval(pollTimer)
        return
      }
      try {
        const popUpWindowLocation = popupWindow.location
        if (encodeURI(popUpWindowLocation.href).indexOf(encodeURI(registeredRedirectUri)) != -1) {
          that.handleWindowCallback(popUpWindowLocation.hash)

          window.clearInterval(pollTimer)
          that._loginInProgress = false
          that._acquireTokenInProgress = false
          that.info('Closing popup window')
          that._openedWindows = []
          popupWindow.close()
          return
        }
      } catch (e) {}
    }, 1)
  }

  _broadcast(eventName, data) {
    // Custom Event is not supported in IE, below IIFE will polyfill the CustomEvent() constructor functionality in Internet Explorer 9 and higher
    ;(() => {
      if (typeof window.CustomEvent === 'function') {
        return false
      }

      function CustomEvent(event, params) {
        params = params || {
          bubbles: false,
          cancelable: false,
          detail: undefined,
        }
        const evt = document.createEvent('CustomEvent')
        evt.initCustomEvent(event, params.bubbles, params.cancelable, params.detail)
        return evt
      }

      CustomEvent = window.Event
      window.CustomEvent = CustomEvent
    })()

    const evt = new CustomEvent(eventName, {
      detail: data,
    })
    window.dispatchEvent(evt)
  }

  loginInProgress() {
    return this._loginInProgress
  }

  /**
   * Checks for the resource in the cache. By default, cache location is Session Storage
   * @ignore
   * @returns {Boolean} 'true' if login is in progress, else returns 'false'.
   */
  _hasResource(key) {
    const keys = this._getItem(this.CONSTANTS.STORAGE.TOKEN_KEYS)
    return (
      keys && !this._isEmpty(keys) && keys.indexOf(key + this.CONSTANTS.RESOURCE_DELIMETER) > -1
    )
  }

  /**
   * Gets token for the specified resource from the cache.
   * @param {string}   resource A URI that identifies the resource for which the token is requested.
   * @returns {string} token if if it exists and not expired, otherwise null.
   */
  getCachedToken(resource = '') {
    const token = this._getItem(this.CONSTANTS.STORAGE.ACCESS_TOKEN_KEY + resource) || ''
    const expiry = this._getItem(this.CONSTANTS.STORAGE.EXPIRATION_KEY + resource)

    // If expiration is within offset, it will force renew
    const offset = this.config.expireOffsetSeconds || 300

    if (expiry && expiry > this._now() + offset) {
      return token
    } else {
      this._saveItem(this.CONSTANTS.STORAGE.ACCESS_TOKEN_KEY + resource, '')
      this._saveItem(
        this.CONSTANTS.STORAGE.EXPIRATION_KEY + resource,
        this._now() + this.CONSTANTS.DEFAULT_EXPIRATION_TIME,
      )
      return null
    }
  }

  /**
   * User information from idtoken.
   *  @class User
   *  @property {string} userName - username assigned from upn or email.
   *  @property {object} profile - properties parsed from idtoken.
   */

  /**
   * If user object exists, returns it. Else creates a new user object by decoding id_token from the cache.
   * @returns {User} user object
   */
  getCachedUser() {
    if (this._user) {
      return this._user
    }

    const idtoken = this._getItem(this.CONSTANTS.STORAGE.IDTOKEN)
    this._user = this._createUser(idtoken)
    return this._user
  }

  /**
   * Adds the passed callback to the array of callbacks for the specified resource and puts the array on the window object.
   * @param {string}   resource A URI that identifies the resource for which the token is requested.
   * @param {string}   expectedState A unique identifier (guid).
   * @param {tokenCallback} callback - The callback provided by the caller. It will be called with token or error.
   */
  registerCallback(expectedState, resource = '', callback) {
    this._activeRenewals[resource] = expectedState

    if (!this._callBacksMappedToRenewStates[expectedState]) {
      this._callBacksMappedToRenewStates[expectedState] = []
    }

    const self = this
    this._callBacksMappedToRenewStates[expectedState].push(callback)

    if (!this._callBackMappedToRenewStates[expectedState]) {
      this._callBackMappedToRenewStates[expectedState] = (errorDesc, token, error, tokenType) => {
        self._activeRenewals[resource] = null

        for (let i = 0; i < self._callBacksMappedToRenewStates[expectedState].length; ++i) {
          try {
            self._callBacksMappedToRenewStates[expectedState][i](errorDesc, token, error, tokenType)
          } catch (error) {
            self.warn(error)
          }
        }

        self._callBacksMappedToRenewStates[expectedState] = null
        self._callBackMappedToRenewStates[expectedState] = null
      }
    }
  }

  // var errorResponse = {error:'', error_description:''};
  // var token = 'string token';
  // callback(errorResponse, token)
  // with callback
  /**
   * Acquires access token with hidden iframe
   * @ignore
   */
  _renewToken(resource = '', callback, responseType) {
    // use iframe to try to renew token
    // use given resource to create new authz url
    this.info('renewToken is called for resource:' + resource)
    const frameHandle = this._addAdalFrame('adalRenewFrame' + resource)
    const expectedState = this._guid() + '|' + resource
    this.config.state = expectedState
    // renew happens in iframe, so it keeps javascript context
    this._renewStates.push(expectedState)
    this.verbose('Renew token Expected state: ' + expectedState)
    // remove the existing prompt=... query parameter and add prompt=none
    responseType = responseType || 'token'
    let urlNavigate = this._urlRemoveQueryStringParameter(
      this._getNavigateUrl(responseType, resource),
      'prompt',
    )

    if (responseType === this.RESPONSE_TYPE.ID_TOKEN_TOKEN) {
      this._idTokenNonce = this._guid()
      this._saveItem(this.CONSTANTS.STORAGE.NONCE_IDTOKEN, this._idTokenNonce, true)
      urlNavigate += '&nonce=' + encodeURIComponent(this._idTokenNonce)
    }

    urlNavigate = urlNavigate + '&prompt=none'
    urlNavigate = this._addHintParameters(urlNavigate)
    this.registerCallback(expectedState, resource, callback)
    this.verbosePii('Navigate to:' + urlNavigate)
    frameHandle.src = 'about:blank'
    this._loadFrameTimeout(urlNavigate, 'adalRenewFrame' + resource, resource)
  }

  /**
   * Renews idtoken for app's own backend when resource is clientId and calls the callback with token/error
   * @ignore
   */
  _renewIdToken(callback, responseType) {
    // use iframe to try to renew token
    this.info('renewIdToken is called')
    const frameHandle = this._addAdalFrame('adalIdTokenFrame')
    const expectedState = this._guid() + '|' + this.config.clientId
    this._idTokenNonce = this._guid()
    this._saveItem(this.CONSTANTS.STORAGE.NONCE_IDTOKEN, this._idTokenNonce, true)
    this.config.state = expectedState
    // renew happens in iframe, so it keeps javascript context
    this._renewStates.push(expectedState)
    this.verbose('Renew Idtoken Expected state: ' + expectedState)
    // remove the existing prompt=... query parameter and add prompt=none
    const resource =
      responseType === null || typeof responseType === 'undefined' ? null : this.config.clientId
    var responseType = responseType || 'id_token'
    let urlNavigate = this._urlRemoveQueryStringParameter(
      this._getNavigateUrl(responseType, resource),
      'prompt',
    )
    urlNavigate = urlNavigate + '&prompt=none'
    urlNavigate = this._addHintParameters(urlNavigate)
    urlNavigate += '&nonce=' + encodeURIComponent(this._idTokenNonce)
    this.registerCallback(expectedState, this.config.clientId, callback)
    this.verbosePii('Navigate to:' + urlNavigate)
    frameHandle.src = 'about:blank'
    this._loadFrameTimeout(urlNavigate, 'adalIdTokenFrame', this.config.clientId)
  }

  /**
   * Checks if the authorization endpoint URL contains query string parameters
   * @ignore
   */
  _urlContainsQueryStringParameter(name, url) {
    // regex to detect pattern of a ? or & followed by the name parameter and an equals character
    const regex = new RegExp('[\\?&]' + name + '=')
    return regex.test(url)
  }

  /**
   * Removes the query string parameter from the authorization endpoint URL if it exists
   * @ignore
   */
  _urlRemoveQueryStringParameter(url, name) {
    // we remove &name=value, name=value& and name=value
    // &name=value
    let regex = new RegExp('(\\&' + name + '=)[^&]+')
    url = url.replace(regex, '')
    // name=value&
    regex = new RegExp('(' + name + '=)[^&]+&')
    url = url.replace(regex, '')
    // name=value
    regex = new RegExp('(' + name + '=)[^&]+')
    url = url.replace(regex, '')
    return url
  }

  // Calling _loadFrame but with a timeout to signal failure in loadframeStatus. Callbacks are left
  // registered when network errors occur and subsequent token requests for same resource are registered to the pending request
  /**
   * @ignore
   */
  _loadFrameTimeout(urlNavigation, frameName, resource) {
    //set iframe session to pending
    this.verbose('Set loading state to pending for: ' + resource)
    this._saveItem(
      this.CONSTANTS.STORAGE.RENEW_STATUS + resource,
      this.CONSTANTS.TOKEN_RENEW_STATUS_IN_PROGRESS,
    )
    this._loadFrame(urlNavigation, frameName)
    const self = this

    setTimeout(() => {
      if (
        self._getItem(self.CONSTANTS.STORAGE.RENEW_STATUS + resource) ===
        self.CONSTANTS.TOKEN_RENEW_STATUS_IN_PROGRESS
      ) {
        // fail the iframe session if it's in pending state
        self.verbose(
          'Loading frame has timed out after: ' +
            self.CONSTANTS.LOADFRAME_TIMEOUT / 1000 +
            ' seconds for resource ' +
            resource,
        )
        const expectedState = self._activeRenewals[resource]

        if (expectedState && self._callBackMappedToRenewStates[expectedState]) {
          self._callBackMappedToRenewStates[expectedState](
            'Token renewal operation failed due to timeout',
            null,
            'Token Renewal Failed',
          )
        }

        self._saveItem(
          self.CONSTANTS.STORAGE.RENEW_STATUS + resource,
          self.CONSTANTS.TOKEN_RENEW_STATUS_CANCELED,
        )
      }
    }, self.CONSTANTS.LOADFRAME_TIMEOUT)
  }

  /**
   * Loads iframe with authorization endpoint URL
   * @ignore
   */
  _loadFrame(urlNavigate, frameName) {
    // This trick overcomes iframe navigation in IE
    // IE does not load the page consistently in iframe
    const self = this
    self.info('LoadFrame: ' + frameName)
    const frameCheck = frameName
    setTimeout(() => {
      const frameHandle = self._addAdalFrame(frameCheck)

      if (frameHandle.src === '' || frameHandle.src === 'about:blank') {
        frameHandle.src = urlNavigate
        self._loadFrame(urlNavigate, frameCheck)
      }
    }, 500)
  }

  /**
   * @callback tokenCallback
   * @param {string} error_description error description returned from AAD if token request fails.
   * @param {string} token token returned from AAD if token request is successful.
   * @param {string} error error message returned from AAD if token request fails.
   */

  /**
   * Acquires token from the cache if it is not expired. Otherwise sends request to AAD to obtain a new token.
   * @param {string}   resource  ResourceUri identifying the target resource
   * @param {tokenCallback} callback -  The callback provided by the caller. It will be called with token or error.
   */
  acquireToken(resource, callback) {
    if (this._isEmpty(resource)) {
      this.warn('resource is required')
      callback('resource is required', null, 'resource is required')
      return
    }

    const token = this.getCachedToken(resource)

    if (token) {
      this.info('Token is already in cache for resource:' + resource)
      callback(null, token, null)
      return
    }

    if (
      !this._user &&
      !(
        this.config.extraQueryParameter &&
        this.config.extraQueryParameter.indexOf('login_hint') !== -1
      )
    ) {
      this.warn('User login is required')
      callback('User login is required', null, 'login required')
      return
    }

    // renew attempt with iframe
    // Already renewing for this resource, callback when we get the token.
    if (this._activeRenewals[resource]) {
      // Active renewals contains the state for each renewal.
      this.registerCallback(this._activeRenewals[resource], resource, callback)
    } else {
      this._requestType = this.REQUEST_TYPE.RENEW_TOKEN
      if (resource === this.config.clientId) {
        // App uses idtoken to send to api endpoints
        // Default resource is tracked as clientid to store this token
        if (this._user) {
          this.verbose('renewing idtoken')
          this._renewIdToken(callback)
        } else {
          this.verbose('renewing idtoken and access_token')
          this._renewIdToken(callback, this.RESPONSE_TYPE.ID_TOKEN_TOKEN)
        }
      } else {
        if (this._user) {
          this.verbose('renewing access_token')
          this._renewToken(resource, callback)
        } else {
          this.verbose('renewing idtoken and access_token')
          this._renewToken(resource, callback, this.RESPONSE_TYPE.ID_TOKEN_TOKEN)
        }
      }
    }
  }

  /**
   * Acquires token (interactive flow using a popUp window) by sending request to AAD to obtain a new token.
   * @param {string}   resource  ResourceUri identifying the target resource
   * @param {string}   extraQueryParameters  extraQueryParameters to add to the authentication request
   * @param {tokenCallback} callback -  The callback provided by the caller. It will be called with token or error.
   */
  acquireTokenPopup(resource, extraQueryParameters, claims, callback) {
    if (this._isEmpty(resource)) {
      this.warn('resource is required')
      callback('resource is required', null, 'resource is required')
      return
    }

    if (!this._user) {
      this.warn('User login is required')
      callback('User login is required', null, 'login required')
      return
    }

    if (this._acquireTokenInProgress) {
      this.warn('Acquire token interactive is already in progress')
      callback(
        'Acquire token interactive is already in progress',
        null,
        'Acquire token interactive is already in progress',
      )
      return
    }

    const expectedState = this._guid() + '|' + resource
    this.config.state = expectedState
    this._renewStates.push(expectedState)
    this._requestType = this.REQUEST_TYPE.RENEW_TOKEN
    this.verbose('Renew token Expected state: ' + expectedState)
    // remove the existing prompt=... query parameter and add prompt=select_account
    let urlNavigate = this._urlRemoveQueryStringParameter(
      this._getNavigateUrl('token', resource),
      'prompt',
    )
    urlNavigate = urlNavigate + '&prompt=select_account'

    if (extraQueryParameters) {
      urlNavigate += extraQueryParameters
    }

    if (claims && urlNavigate.indexOf('&claims') === -1) {
      urlNavigate += '&claims=' + encodeURIComponent(claims)
    } else if (claims && urlNavigate.indexOf('&claims') !== -1) {
      throw new Error('Claims cannot be passed as an extraQueryParameter')
    }

    urlNavigate = this._addHintParameters(urlNavigate)
    this._acquireTokenInProgress = true
    this.info('acquireToken interactive is called for the resource ' + resource)
    this.registerCallback(expectedState, resource, callback)
    this._loginPopup(urlNavigate, resource, callback)
  }

  /**
   * Acquires token (interactive flow using a redirect) by sending request to AAD to obtain a new token. In this case the callback passed in the Authentication
   * request constructor will be called.
   * @param {string}   resource  ResourceUri identifying the target resource
   * @param {string}   extraQueryParameters  extraQueryParameters to add to the authentication request
   */
  acquireTokenRedirect(resource, extraQueryParameters, claims) {
    if (this._isEmpty(resource)) {
      this.warn('resource is required')
      callback('resource is required', null, 'resource is required')
      return
    }

    var callback = this.callback

    if (!this._user) {
      this.warn('User login is required')
      callback('User login is required', null, 'login required')
      return
    }

    if (this._acquireTokenInProgress) {
      this.warn('Acquire token interactive is already in progress')
      callback(
        'Acquire token interactive is already in progress',
        null,
        'Acquire token interactive is already in progress',
      )
      return
    }

    const expectedState = this._guid() + '|' + resource
    this.config.state = expectedState
    this.verbose('Renew token Expected state: ' + expectedState)

    // remove the existing prompt=... query parameter and add prompt=select_account
    let urlNavigate = this._urlRemoveQueryStringParameter(
      this._getNavigateUrl('token', resource),
      'prompt',
    )
    urlNavigate = urlNavigate + '&prompt=select_account'
    if (extraQueryParameters) {
      urlNavigate += extraQueryParameters
    }

    if (claims && urlNavigate.indexOf('&claims') === -1) {
      urlNavigate += '&claims=' + encodeURIComponent(claims)
    } else if (claims && urlNavigate.indexOf('&claims') !== -1) {
      throw new Error('Claims cannot be passed as an extraQueryParameter')
    }

    urlNavigate = this._addHintParameters(urlNavigate)
    this._acquireTokenInProgress = true
    this.info('acquireToken interactive is called for the resource ' + resource)
    this._saveItem(this.CONSTANTS.STORAGE.LOGIN_REQUEST, window.location.href)
    this._saveItem(this.CONSTANTS.STORAGE.STATE_RENEW, expectedState, true)
    this.promptUser(urlNavigate)
  }
  /**
   * Redirects the browser to Azure AD authorization endpoint.
   * @param {string}   urlNavigate  Url of the authorization endpoint.
   */
  promptUser(urlNavigate) {
    if (urlNavigate) {
      this.infoPii('Navigate to:' + urlNavigate)
      window.location.replace(urlNavigate)
    } else {
      this.info('Navigate url is empty')
    }
  }

  /**
   * Clears cache items.
   */
  clearCache() {
    this._saveItem(this.CONSTANTS.STORAGE.LOGIN_REQUEST, '')
    this._saveItem(this.CONSTANTS.STORAGE.ANGULAR_LOGIN_REQUEST, '')
    this._saveItem(this.CONSTANTS.STORAGE.SESSION_STATE, '')
    this._saveItem(this.CONSTANTS.STORAGE.STATE_LOGIN, '')
    this._saveItem(this.CONSTANTS.STORAGE.STATE_RENEW, '')
    this._renewStates = []
    this._saveItem(this.CONSTANTS.STORAGE.NONCE_IDTOKEN, '')
    this._saveItem(this.CONSTANTS.STORAGE.IDTOKEN, '')
    this._saveItem(this.CONSTANTS.STORAGE.ERROR, '')
    this._saveItem(this.CONSTANTS.STORAGE.ERROR_DESCRIPTION, '')
    this._saveItem(this.CONSTANTS.STORAGE.LOGIN_ERROR, '')
    this._saveItem(this.CONSTANTS.STORAGE.LOGIN_ERROR, '')
    let keys = this._getItem(this.CONSTANTS.STORAGE.TOKEN_KEYS)

    if (!this._isEmpty(keys)) {
      keys = keys.split(this.CONSTANTS.RESOURCE_DELIMETER)
      for (let i = 0; i < keys.length && keys[i] !== ''; i++) {
        this._saveItem(this.CONSTANTS.STORAGE.ACCESS_TOKEN_KEY + keys[i], '')
        this._saveItem(this.CONSTANTS.STORAGE.EXPIRATION_KEY + keys[i], 0)
      }
    }

    this._saveItem(this.CONSTANTS.STORAGE.TOKEN_KEYS, '')
  }

  /**
   * Clears cache items for a given resource.
   * @param {string}  resource a URI that identifies the resource.
   */
  clearCacheForResource(resource) {
    this._saveItem(this.CONSTANTS.STORAGE.STATE_RENEW, '')
    this._saveItem(this.CONSTANTS.STORAGE.ERROR, '')
    this._saveItem(this.CONSTANTS.STORAGE.ERROR_DESCRIPTION, '')

    if (this._hasResource(resource)) {
      this._saveItem(this.CONSTANTS.STORAGE.ACCESS_TOKEN_KEY + resource, '')
      this._saveItem(this.CONSTANTS.STORAGE.EXPIRATION_KEY + resource, 0)
    }
  }

  /**
   * Redirects user to logout endpoint.
   * After logout, it will redirect to postLogoutRedirectUri if added as a property on the config object.
   */
  logOut() {
    this.clearCache()
    this._user = null
    let urlNavigate

    if (this.config.logOutUri) {
      urlNavigate = this.config.logOutUri
    } else {
      let tenant = 'common'
      let logout = ''

      if (this.config.tenant) {
        tenant = this.config.tenant
      }

      if (this.config.postLogoutRedirectUri) {
        logout = 'post_logout_redirect_uri=' + encodeURIComponent(this.config.postLogoutRedirectUri)
      }

      urlNavigate = this.instance + tenant + '/oauth2/logout?' + logout
    }

    this.infoPii('Logout navigate to: ' + urlNavigate)
    this.promptUser(urlNavigate)
  }

  _isEmpty(str) {
    return typeof str === 'undefined' || !str || 0 === str.length
  }

  /**
   * @callback userCallback
   * @param {string} error error message if user info is not available.
   * @param {User} user user object retrieved from the cache.
   */

  /**
   * Calls the passed in callback with the user object or error message related to the user.
   * @param {userCallback} callback - The callback provided by the caller. It will be called with user or error.
   */
  getUser(callback) {
    // IDToken is first call
    if (typeof callback !== 'function') {
      throw new Error('callback is not a function')
    }

    // user in memory
    if (this._user) {
      callback(null, this._user)
      return
    }

    // frame is used to get idtoken
    const idtoken = this._getItem(this.CONSTANTS.STORAGE.IDTOKEN)

    if (!this._isEmpty(idtoken)) {
      this.info('User exists in cache: ')
      this._user = this._createUser(idtoken)
      callback(null, this._user)
    } else {
      this.warn('User information is not available')
      callback('User information is not available', null)
    }
  }

  /**
   * Adds login_hint to authorization URL which is used to pre-fill the username field of sign in page for the user if known ahead of time.
   * domain_hint can be one of users/organisations which when added skips the email based discovery process of the user.
   * @ignore
   */
  _addHintParameters(urlNavigate) {
    //If you don�t use prompt=none, then if the session does not exist, there will be a failure.
    //If sid is sent alongside domain or login hints, there will be a failure since request is ambiguous.
    //If sid is sent with a prompt value other than none or attempt_none, there will be a failure since the request is ambiguous.

    if (this._user && this._user.profile) {
      if (this._user.profile.sid && urlNavigate.indexOf('&prompt=none') !== -1) {
        // don't add sid twice if user provided it in the extraQueryParameter value
        if (!this._urlContainsQueryStringParameter('sid', urlNavigate)) {
          // add sid
          urlNavigate += '&sid=' + encodeURIComponent(this._user.profile.sid)
        }
      } else if (this._user.profile.upn) {
        // don't add login_hint twice if user provided it in the extraQueryParameter value
        if (!this._urlContainsQueryStringParameter('login_hint', urlNavigate)) {
          // add login_hint
          urlNavigate += '&login_hint=' + encodeURIComponent(this._user.profile.upn)
        }
        // don't add domain_hint twice if user provided it in the extraQueryParameter value
        if (
          !this._urlContainsQueryStringParameter('domain_hint', urlNavigate) &&
          this._user.profile.upn.indexOf('@') > -1
        ) {
          const parts = this._user.profile.upn.split('@')
          // local part can include @ in quotes. Sending last part handles that.
          urlNavigate += '&domain_hint=' + encodeURIComponent(parts[parts.length - 1])
        }
      }
    }

    return urlNavigate
  }

  /**
   * Creates a user object by decoding the id_token
   * @ignore
   */
  _createUser(idToken) {
    let user = null
    const parsedJson = this._extractIdToken(idToken)
    if (parsedJson && parsedJson.hasOwnProperty('aud')) {
      if (parsedJson.aud.toLowerCase() === this.config.clientId.toLowerCase()) {
        user = {
          userName: '',
          profile: parsedJson,
        }

        if (parsedJson.hasOwnProperty('upn')) {
          user.userName = parsedJson.upn
        } else if (parsedJson.hasOwnProperty('email')) {
          user.userName = parsedJson.email
        }
      } else {
        this.warn('IdToken has invalid aud field')
      }
    }

    return user
  }

  /**
   * Returns the anchor part(#) of the URL
   * @ignore
   */
  _getHash(hash) {
    if (hash.indexOf('#/') > -1) {
      hash = hash.substring(hash.indexOf('#/') + 2)
    } else if (hash.indexOf('#') > -1) {
      hash = hash.substring(1)
    }

    return hash
  }

  /**
   * Checks if the URL fragment contains access token, id token or error_description.
   * @param {string} hash  -  Hash passed from redirect page
   * @returns {Boolean} true if response contains id_token, access_token or error, false otherwise.
   */
  isCallback(hash) {
    hash = this._getHash(hash)
    const parameters = this._deserialize(hash)
    return (
      parameters.hasOwnProperty(this.CONSTANTS.ERROR_DESCRIPTION) ||
      parameters.hasOwnProperty(this.CONSTANTS.ACCESS_TOKEN) ||
      parameters.hasOwnProperty(this.CONSTANTS.ID_TOKEN)
    )
  }

  /**
   * Gets login error
   * @returns {string} error message related to login.
   */
  getLoginError() {
    return this._getItem(this.CONSTANTS.STORAGE.LOGIN_ERROR)
  }

  /**
   * Request info object created from the response received from AAD.
   *  @class RequestInfo
   *  @property {object} parameters - object comprising of fields such as id_token/error, session_state, state, e.t.c.
   *  @property {REQUEST_TYPE} requestType - either LOGIN, RENEW_TOKEN or UNKNOWN.
   *  @property {boolean} stateMatch - true if state is valid, false otherwise.
   *  @property {string} stateResponse - unique guid used to match the response with the request.
   *  @property {boolean} valid - true if requestType contains id_token, access_token or error, false otherwise.
   */

  /**
   * Creates a requestInfo object from the URL fragment and returns it.
   * @returns {RequestInfo} an object created from the redirect response from AAD comprising of the keys - parameters, requestType, stateMatch, stateResponse and valid.
   */
  getRequestInfo(hash) {
    hash = this._getHash(hash)
    const parameters = this._deserialize(hash)
    const requestInfo = {
      valid: false,
      parameters: {},
      stateMatch: false,
      stateResponse: '',
      requestType: this.REQUEST_TYPE.UNKNOWN,
    }

    if (parameters) {
      requestInfo.parameters = parameters
      if (
        parameters.hasOwnProperty(this.CONSTANTS.ERROR_DESCRIPTION) ||
        parameters.hasOwnProperty(this.CONSTANTS.ACCESS_TOKEN) ||
        parameters.hasOwnProperty(this.CONSTANTS.ID_TOKEN)
      ) {
        requestInfo.valid = true

        // which call
        let stateResponse = ''
        if (parameters.hasOwnProperty('state')) {
          this.verbose('State: ' + parameters.state)
          stateResponse = parameters.state
        } else {
          this.warn('No state returned')
          return requestInfo
        }

        requestInfo.stateResponse = stateResponse

        // async calls can fire iframe and login request at the same time if developer does not use the API as expected
        // incoming callback needs to be looked up to find the request type
        if (this._matchState(requestInfo)) {
          // loginRedirect or acquireTokenRedirect
          return requestInfo
        }

        // external api requests may have many renewtoken requests for different resource
        if (!requestInfo.stateMatch && window.parent) {
          requestInfo.requestType = this._requestType
          const statesInParentContext = this._renewStates
          for (let i = 0; i < statesInParentContext.length; i++) {
            if (statesInParentContext[i] === requestInfo.stateResponse) {
              requestInfo.stateMatch = true
              break
            }
          }
        }
      }
    }
    return requestInfo
  }

  /**
   * Matches nonce from the request with the response.
   * @ignore
   */
  _matchNonce(user) {
    let requestNonce = this._getItem(this.CONSTANTS.STORAGE.NONCE_IDTOKEN)

    if (requestNonce) {
      requestNonce = requestNonce.split(this.CONSTANTS.CACHE_DELIMETER)
      for (let i = 0; i < requestNonce.length; i++) {
        if (requestNonce[i] === user.profile.nonce) {
          return true
        }
      }
    }

    return false
  }

  /**
   * Matches state from the request with the response.
   * @ignore
   */
  _matchState(requestInfo) {
    let loginStates = this._getItem(this.CONSTANTS.STORAGE.STATE_LOGIN)

    if (loginStates) {
      loginStates = loginStates.split(this.CONSTANTS.CACHE_DELIMETER)
      for (var i = 0; i < loginStates.length; i++) {
        if (loginStates[i] === requestInfo.stateResponse) {
          requestInfo.requestType = this.REQUEST_TYPE.LOGIN
          requestInfo.stateMatch = true
          return true
        }
      }
    }

    let acquireTokenStates = this._getItem(this.CONSTANTS.STORAGE.STATE_RENEW)

    if (acquireTokenStates) {
      acquireTokenStates = acquireTokenStates.split(this.CONSTANTS.CACHE_DELIMETER)
      for (var i = 0; i < acquireTokenStates.length; i++) {
        if (acquireTokenStates[i] === requestInfo.stateResponse) {
          requestInfo.requestType = this.REQUEST_TYPE.RENEW_TOKEN
          requestInfo.stateMatch = true
          return true
        }
      }
    }

    return false
  }

  /**
   * Extracts resource value from state.
   * @ignore
   */
  _getResourceFromState(state) {
    if (state) {
      const splitIndex = state.indexOf('|')

      if (splitIndex > -1 && splitIndex + 1 < state.length) {
        return state.substring(splitIndex + 1)
      }
    }

    return ''
  }

  /**
   * Saves token or error received in the response from AAD in the cache. In case of id_token, it also creates the user object.
   */
  saveTokenFromHash(requestInfo) {
    this.info(
      'State status:' + requestInfo.stateMatch + '; Request type:' + requestInfo.requestType,
    )
    this._saveItem(this.CONSTANTS.STORAGE.ERROR, '')
    this._saveItem(this.CONSTANTS.STORAGE.ERROR_DESCRIPTION, '')

    let resource = this._getResourceFromState(requestInfo.stateResponse)

    // Record error
    if (requestInfo.parameters.hasOwnProperty(this.CONSTANTS.ERROR_DESCRIPTION)) {
      this.infoPii(
        'Error :' +
          requestInfo.parameters.error +
          '; Error description:' +
          requestInfo.parameters[this.CONSTANTS.ERROR_DESCRIPTION],
      )
      this._saveItem(this.CONSTANTS.STORAGE.ERROR, requestInfo.parameters.error)
      this._saveItem(
        this.CONSTANTS.STORAGE.ERROR_DESCRIPTION,
        requestInfo.parameters[this.CONSTANTS.ERROR_DESCRIPTION],
      )

      if (requestInfo.requestType === this.REQUEST_TYPE.LOGIN) {
        this._loginInProgress = false
        this._saveItem(this.CONSTANTS.STORAGE.LOGIN_ERROR, requestInfo.parameters.error_description)
      }
    } else {
      // It must verify the state from redirect
      if (requestInfo.stateMatch) {
        // record tokens to storage if exists
        this.info('State is right')
        if (requestInfo.parameters.hasOwnProperty(this.CONSTANTS.SESSION_STATE)) {
          this._saveItem(
            this.CONSTANTS.STORAGE.SESSION_STATE,
            requestInfo.parameters[this.CONSTANTS.SESSION_STATE],
          )
        }

        let keys

        if (requestInfo.parameters.hasOwnProperty(this.CONSTANTS.ACCESS_TOKEN)) {
          this.info('Fragment has access token')

          if (!this._hasResource(resource)) {
            keys = this._getItem(this.CONSTANTS.STORAGE.TOKEN_KEYS) || ''
            this._saveItem(
              this.CONSTANTS.STORAGE.TOKEN_KEYS,
              keys + resource + this.CONSTANTS.RESOURCE_DELIMETER,
            )
          }

          // save token with related resource
          this._saveItem(
            this.CONSTANTS.STORAGE.ACCESS_TOKEN_KEY + resource,
            requestInfo.parameters[this.CONSTANTS.ACCESS_TOKEN],
          )
          this._saveItem(
            this.CONSTANTS.STORAGE.EXPIRATION_KEY + resource,
            this._expiresIn(requestInfo.parameters[this.CONSTANTS.EXPIRES_IN]),
          )
        }

        if (requestInfo.parameters.hasOwnProperty(this.CONSTANTS.ID_TOKEN)) {
          this.info('Fragment has id token')
          this._loginInProgress = false
          this._user = this._createUser(requestInfo.parameters[this.CONSTANTS.ID_TOKEN])
          if (this._user && this._user.profile) {
            if (!this._matchNonce(this._user)) {
              this._saveItem(
                this.CONSTANTS.STORAGE.LOGIN_ERROR,
                'Nonce received: ' +
                  this._user.profile.nonce +
                  ' is not same as requested: ' +
                  this._getItem(this.CONSTANTS.STORAGE.NONCE_IDTOKEN),
              )
              this._user = null
            } else {
              this._saveItem(
                this.CONSTANTS.STORAGE.IDTOKEN,
                requestInfo.parameters[this.CONSTANTS.ID_TOKEN],
              )

              // Save idtoken as access token for app itself
              resource = this.config.loginResource
                ? this.config.loginResource
                : this.config.clientId

              if (!this._hasResource(resource)) {
                keys = this._getItem(this.CONSTANTS.STORAGE.TOKEN_KEYS) || ''
                this._saveItem(
                  this.CONSTANTS.STORAGE.TOKEN_KEYS,
                  keys + resource + this.CONSTANTS.RESOURCE_DELIMETER,
                )
              }

              this._saveItem(
                this.CONSTANTS.STORAGE.ACCESS_TOKEN_KEY + resource,
                requestInfo.parameters[this.CONSTANTS.ID_TOKEN],
              )
              this._saveItem(
                this.CONSTANTS.STORAGE.EXPIRATION_KEY + resource,
                this._user.profile.exp,
              )
            }
          } else {
            requestInfo.parameters['error'] = 'invalid id_token'
            requestInfo.parameters['error_description'] =
              'Invalid id_token. id_token: ' + requestInfo.parameters[this.CONSTANTS.ID_TOKEN]
            this._saveItem(this.CONSTANTS.STORAGE.ERROR, 'invalid id_token')
            this._saveItem(
              this.CONSTANTS.STORAGE.ERROR_DESCRIPTION,
              'Invalid id_token. id_token: ' + requestInfo.parameters[this.CONSTANTS.ID_TOKEN],
            )
          }
        }
      } else {
        requestInfo.parameters['error'] = 'Invalid_state'
        requestInfo.parameters['error_description'] =
          'Invalid_state. state: ' + requestInfo.stateResponse
        this._saveItem(this.CONSTANTS.STORAGE.ERROR, 'Invalid_state')
        this._saveItem(
          this.CONSTANTS.STORAGE.ERROR_DESCRIPTION,
          'Invalid_state. state: ' + requestInfo.stateResponse,
        )
      }
    }

    this._saveItem(
      this.CONSTANTS.STORAGE.RENEW_STATUS + resource,
      this.CONSTANTS.TOKEN_RENEW_STATUS_COMPLETED,
    )
  }

  /**
   * Gets resource for given endpoint if mapping is provided with config.
   * @param {string} endpoint  -  The URI for which the resource Id is requested.
   * @returns {string} resource for this API endpoint.
   */
  getResourceForEndpoint(endpoint) {
    // if user specified list of anonymous endpoints, no need to send token to these endpoints, return null.
    if (this.config && this.config.anonymousEndpoints) {
      for (let i = 0; i < this.config.anonymousEndpoints.length; i++) {
        if (endpoint.indexOf(this.config.anonymousEndpoints[i]) > -1) {
          return null
        }
      }
    }

    if (this.config && this.config.endpoints) {
      for (const configEndpoint in this.config.endpoints) {
        // configEndpoint is like /api/Todo requested endpoint can be /api/Todo/1
        if (endpoint.indexOf(configEndpoint) > -1) {
          return this.config.endpoints[configEndpoint]
        }
      }
    }

    // default resource will be clientid if nothing specified
    // App will use idtoken for calls to itself
    // check if it's staring from http or https, needs to match with app host
    if (endpoint.indexOf('http://') > -1 || endpoint.indexOf('https://') > -1) {
      if (this._getHostFromUri(endpoint) === this._getHostFromUri(this.config.redirectUri)) {
        return this.config.loginResource
      }
    } else {
      // in angular level, the url for $http interceptor call could be relative url,
      // if it's relative call, we'll treat it as app backend call.
      return this.config.loginResource
    }

    // if not the app's own backend or not a domain listed in the endpoints structure
    return null
  }

  /**
   * Strips the protocol part of the URL and returns it.
   * @ignore
   */
  _getHostFromUri(uri) {
    // remove http:// or https:// from uri
    let extractedUri = String(uri).replace(/^(https?:)\/\//, '')
    extractedUri = extractedUri.split('/')[0]
    return extractedUri
  }

  /**
   * This method must be called for processing the response received from AAD. It extracts the hash, processes the token or error, saves it in the cache and calls the registered callbacks with the result.
   * @param {string} [hash=window.location.hash] - Hash fragment of Url.
   */
  handleWindowCallback(hash) {
    // This is for regular javascript usage for redirect handling
    // need to make sure this is for callback
    if (hash == null) {
      hash = window.location.hash
    }

    if (this.isCallback(hash)) {
      let self = null
      let isPopup = false

      if (
        this._openedWindows.length > 0 &&
        this._openedWindows[this._openedWindows.length - 1].opener &&
        this._openedWindows[this._openedWindows.length - 1].opener._adalInstance
      ) {
        self = this._openedWindows[this._openedWindows.length - 1].opener._adalInstance
        isPopup = true
      } else if (window.parent && window.parent._adalInstance) {
        self = window.parent._adalInstance
      }

      const requestInfo = self.getRequestInfo(hash)
      let token,
        tokenReceivedCallback,
        tokenType = null

      if (isPopup || window.parent !== window) {
        tokenReceivedCallback = self._callBackMappedToRenewStates[requestInfo.stateResponse]
      } else {
        tokenReceivedCallback = self.callback
      }

      self.info('Returned from redirect url')
      self.saveTokenFromHash(requestInfo)

      if (requestInfo.requestType === this.REQUEST_TYPE.RENEW_TOKEN && window.parent) {
        if (window.parent !== window) {
          self.verbose('Window is in iframe, acquiring token silently')
        } else {
          self.verbose('acquiring token interactive in progress')
        }

        token =
          requestInfo.parameters[self.CONSTANTS.ACCESS_TOKEN] ||
          requestInfo.parameters[self.CONSTANTS.ID_TOKEN]
        tokenType = self.CONSTANTS.ACCESS_TOKEN
      } else if (requestInfo.requestType === this.REQUEST_TYPE.LOGIN) {
        token = requestInfo.parameters[self.CONSTANTS.ID_TOKEN]
        tokenType = self.CONSTANTS.ID_TOKEN
      }

      const errorDesc = requestInfo.parameters[self.CONSTANTS.ERROR_DESCRIPTION]
      const error = requestInfo.parameters[self.CONSTANTS.ERROR]
      try {
        if (tokenReceivedCallback) {
          tokenReceivedCallback(errorDesc, token, error, tokenType)
        }
      } catch (err) {
        self.error('Error occurred in user defined callback function: ' + err)
      }

      if (window.parent === window && !isPopup) {
        if (self.config.navigateToLoginRequestUrl) {
          window.location.href = self._getItem(self.CONSTANTS.STORAGE.LOGIN_REQUEST)
        } else window.location.hash = ''
      }
    }
  }

  /**
   * Constructs the authorization endpoint URL and returns it.
   * @ignore
   */
  _getNavigateUrl(responseType, resource) {
    let tenant = 'common'
    if (this.config.tenant) {
      tenant = this.config.tenant
    }

    const urlNavigate =
      this.instance +
      tenant +
      '/oauth2/authorize' +
      this._serialize(responseType, this.config, resource) +
      this._addLibMetadata()
    this.info('Navigate url:' + urlNavigate)
    return urlNavigate
  }

  /**
   * Returns the decoded id_token.
   * @ignore
   */
  _extractIdToken(encodedIdToken) {
    // id token will be decoded to get the username
    const decodedToken = this._decodeJwt(encodedIdToken)

    if (!decodedToken) {
      return null
    }

    try {
      const base64IdToken = decodedToken.JWSPayload
      const base64Decoded = this._base64DecodeStringUrlSafe(base64IdToken)

      if (!base64Decoded) {
        this.info('The returned id_token could not be base64 url safe decoded.')
        return null
      }

      // ECMA script has JSON built-in support
      return JSON.parse(base64Decoded)
    } catch (err) {
      this.error('The returned id_token could not be decoded', err)
    }

    return null
  }

  /**
   * Decodes a string of data which has been encoded using base-64 encoding.
   * @ignore
   */
  _base64DecodeStringUrlSafe(base64IdToken) {
    // html5 should support atob function for decoding
    base64IdToken = base64IdToken.replace(/-/g, '+').replace(/_/g, '/')

    if (window.atob) {
      return decodeURIComponent(escape(window.atob(base64IdToken))) // jshint ignore:line
    } else {
      return decodeURIComponent(escape(this._decode(base64IdToken)))
    }
  }

  //Take https://cdnjs.cloudflare.com/ajax/libs/Base64/0.3.0/base64.js and https://en.wikipedia.org/wiki/Base64 as reference.
  _decode(base64IdToken) {
    const codes = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='
    base64IdToken = String(base64IdToken).replace(/=+$/, '')

    const length = base64IdToken.length

    if (length % 4 === 1) {
      throw new Error('The token to be decoded is not correctly encoded.')
    }

    let h1,
      h2,
      h3,
      h4,
      bits,
      c1,
      c2,
      c3,
      decoded = ''

    for (let i = 0; i < length; i += 4) {
      //Every 4 base64 encoded character will be converted to 3 byte string, which is 24 bits
      // then 6 bits per base64 encoded character
      h1 = codes.indexOf(base64IdToken.charAt(i))
      h2 = codes.indexOf(base64IdToken.charAt(i + 1))
      h3 = codes.indexOf(base64IdToken.charAt(i + 2))
      h4 = codes.indexOf(base64IdToken.charAt(i + 3))

      // For padding, if last two are '='
      if (i + 2 === length - 1) {
        bits = (h1 << 18) | (h2 << 12) | (h3 << 6)
        c1 = (bits >> 16) & 255
        c2 = (bits >> 8) & 255
        decoded += String.fromCharCode(c1, c2)
        break
      }
      // if last one is '='
      else if (i + 1 === length - 1) {
        bits = (h1 << 18) | (h2 << 12)
        c1 = (bits >> 16) & 255
        decoded += String.fromCharCode(c1)
        break
      }

      bits = (h1 << 18) | (h2 << 12) | (h3 << 6) | h4

      // then convert to 3 byte chars
      c1 = (bits >> 16) & 255
      c2 = (bits >> 8) & 255
      c3 = bits & 255

      decoded += String.fromCharCode(c1, c2, c3)
    }

    return decoded
  }

  /**
   * Decodes an id token into an object with header, payload and signature fields.
   * @ignore
   */
  // Adal.node js crack function
  _decodeJwt(jwtToken) {
    if (this._isEmpty(jwtToken)) {
      return null
    }

    const idTokenPartsRegex = /^([^\.\s]*)\.([^\.\s]+)\.([^\.\s]*)$/

    const matches = idTokenPartsRegex.exec(jwtToken)

    if (!matches || matches.length < 4) {
      this.warn('The returned id_token is not parseable.')
      return null
    }

    const crackedToken = {
      header: matches[1],
      JWSPayload: matches[2],
      JWSSig: matches[3],
    }

    return crackedToken
  }

  /**
   * Converts string to represent binary data in ASCII string format by translating it into a radix-64 representation and returns it
   * @ignore
   */
  _convertUrlSafeToRegularBase64EncodedString(str) {
    return str.replace('-', '+').replace('_', '/')
  }

  /**
   * Serializes the parameters for the authorization endpoint URL and returns the serialized uri string.
   * @ignore
   */
  _serialize(responseType, obj, resource) {
    const str = []

    if (obj !== null) {
      str.push('?response_type=' + 'id_token token')
      str.push('client_id=' + encodeURIComponent(obj.clientId))
      str.push('resource=' + encodeURIComponent(obj.clientId))

      str.push('redirect_uri=' + encodeURIComponent(obj.redirectUri))
      str.push('state=' + encodeURIComponent(obj.state))

      if (obj.hasOwnProperty('slice')) {
        str.push('slice=' + encodeURIComponent(obj.slice))
      }

      if (obj.hasOwnProperty('extraQueryParameter')) {
        str.push(obj.extraQueryParameter)
      }

      const correlationId = obj.correlationId ? obj.correlationId : this._guid()
      str.push('client-request-id=' + encodeURIComponent(correlationId))
    }

    return str.join('&')
  }

  /**
   * Parses the query string parameters into a key-value pair object.
   * @ignore
   */
  _deserialize(query) {
    let match

    const // Regex for replacing addition symbol with a space
      pl = /\+/g

    const search = /([^&=]+)=([^&]*)/g

    const decode = (s) => decodeURIComponent(s.replace(pl, ' '))

    const obj = {}
    match = search.exec(query)

    while (match) {
      obj[decode(match[1])] = decode(match[2])
      match = search.exec(query)
    }

    return obj
  }

  /**
   * Converts decimal value to hex equivalent
   * @ignore
   */
  _decimalToHex(number) {
    let hex = number.toString(16)

    while (hex.length < 2) {
      hex = '0' + hex
    }
    return hex
  }

  /**
   * Generates RFC4122 version 4 guid (128 bits)
   * @ignore
   */
  /* jshint ignore:start */
  _guid() {
    // RFC4122: The version 4 UUID is meant for generating UUIDs from truly-random or
    // pseudo-random numbers.
    // The algorithm is as follows:
    //     Set the two most significant bits (bits 6 and 7) of the
    //        clock_seq_hi_and_reserved to zero and one, respectively.
    //     Set the four most significant bits (bits 12 through 15) of the
    //        time_hi_and_version field to the 4-bit version number from
    //        Section 4.1.3. Version4
    //     Set all the other bits to randomly (or pseudo-randomly) chosen
    //     values.
    // UUID                   = time-low "-" time-mid "-"time-high-and-version "-"clock-seq-reserved and low(2hexOctet)"-" node
    // time-low               = 4hexOctet
    // time-mid               = 2hexOctet
    // time-high-and-version  = 2hexOctet
    // clock-seq-and-reserved = hexOctet:
    // clock-seq-low          = hexOctet
    // node                   = 6hexOctet
    // Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    // y could be 1000, 1001, 1010, 1011 since most significant two bits needs to be 10
    // y values are 8, 9, A, B
    const cryptoObj = window.crypto || window.msCrypto // for IE 11
    if (cryptoObj && cryptoObj.getRandomValues) {
      const buffer = new Uint8Array(16)
      cryptoObj.getRandomValues(buffer)
      //buffer[6] and buffer[7] represents the time_hi_and_version field. We will set the four most significant bits (4 through 7) of buffer[6] to represent decimal number 4 (UUID version number).
      buffer[6] |= 0x40 //buffer[6] | 01000000 will set the 6 bit to 1.
      buffer[6] &= 0x4f //buffer[6] & 01001111 will set the 4, 5, and 7 bit to 0 such that bits 4-7 == 0100 = "4".
      //buffer[8] represents the clock_seq_hi_and_reserved field. We will set the two most significant bits (6 and 7) of the clock_seq_hi_and_reserved to zero and one, respectively.
      buffer[8] |= 0x80 //buffer[8] | 10000000 will set the 7 bit to 1.
      buffer[8] &= 0xbf //buffer[8] & 10111111 will set the 6 bit to 0.
      return (
        this._decimalToHex(buffer[0]) +
        this._decimalToHex(buffer[1]) +
        this._decimalToHex(buffer[2]) +
        this._decimalToHex(buffer[3]) +
        '-' +
        this._decimalToHex(buffer[4]) +
        this._decimalToHex(buffer[5]) +
        '-' +
        this._decimalToHex(buffer[6]) +
        this._decimalToHex(buffer[7]) +
        '-' +
        this._decimalToHex(buffer[8]) +
        this._decimalToHex(buffer[9]) +
        '-' +
        this._decimalToHex(buffer[10]) +
        this._decimalToHex(buffer[11]) +
        this._decimalToHex(buffer[12]) +
        this._decimalToHex(buffer[13]) +
        this._decimalToHex(buffer[14]) +
        this._decimalToHex(buffer[15])
      )
    } else {
      const guidHolder = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
      const hex = '0123456789abcdef'
      let r = 0
      let guidResponse = ''
      for (let i = 0; i < 36; i++) {
        if (guidHolder[i] !== '-' && guidHolder[i] !== '4') {
          // each x and y needs to be random
          r = (Math.random() * 16) | 0
        }
        if (guidHolder[i] === 'x') {
          guidResponse += hex[r]
        } else if (guidHolder[i] === 'y') {
          // clock-seq-and-reserved first hex is filtered and remaining hex values are random
          r &= 0x3 // bit and with 0011 to set pos 2 to zero ?0??
          r |= 0x8 // set pos 3 to 1 as 1???
          guidResponse += hex[r]
        } else {
          guidResponse += guidHolder[i]
        }
      }
      return guidResponse
    }
  }
  /* jshint ignore:end */

  /**
   * Calculates the expires in value in milliseconds for the acquired token
   * @ignore
   */
  _expiresIn(expires) {
    // if AAD did not send "expires_in" property, use default expiration of 8640000 seconds, for some reason AAD sends 8640000 as "expires_in" value instead of 3600
    if (!expires || expires == 0) expires = 8640000
    return this._now() + parseInt(expires, 10)
  }

  /**
   * Return the number of milliseconds since 1970/01/01
   * @ignore
   */
  _now() {
    return Math.round(new Date().getTime() / 1000.0)
  }

  /**
   * Adds the hidden iframe for silent token renewal
   * @ignore
   */
  _addAdalFrame(iframeId) {
    if (typeof iframeId === 'undefined') {
      return
    }

    this.info('Add adal frame to document:' + iframeId)
    let adalFrame = document.getElementById(iframeId)

    if (!adalFrame) {
      if (
        document.createElement &&
        document.documentElement &&
        (window.opera || window.navigator.userAgent.indexOf('MSIE 5.0') === -1)
      ) {
        const ifr = document.createElement('iframe')
        ifr.setAttribute('id', iframeId)
        ifr.setAttribute('aria-hidden', 'true')
        ifr.style.visibility = 'hidden'
        ifr.style.position = 'absolute'
        ifr.style.width = ifr.style.height = ifr.borderWidth = '0px'

        adalFrame = document.getElementsByTagName('body')[0].appendChild(ifr)
      } else if (document.body && document.body.insertAdjacentHTML) {
        document.body.insertAdjacentHTML(
          'beforeEnd',
          '<iframe name="' + iframeId + '" id="' + iframeId + '" style="display:none"></iframe>',
        )
      }
      if (window.frames && window.frames[iframeId]) {
        adalFrame = window.frames[iframeId]
      }
    }

    return adalFrame
  }

  /**
   * Saves the key-value pair in the cache
   * @ignore
   */
  _saveItem(key, obj, preserve) {
    if (this.config && this.config.cacheLocation && this.config.cacheLocation === 'localStorage') {
      if (!this._supportsLocalStorage()) {
        this.info('Local storage is not supported')
        return false
      }

      if (preserve) {
        const value = this._getItem(key) || ''
        localStorage.setItem(key, value + obj + this.CONSTANTS.CACHE_DELIMETER)
      } else {
        localStorage.setItem(key, obj)
      }

      return true
    }

    // Default as session storage
    if (!this._supportsSessionStorage()) {
      this.info('Session storage is not supported')
      return false
    }

    sessionStorage.setItem(key, obj)
    return true
  }

  /**
   * Searches the value for the given key in the cache
   * @ignore
   */
  _getItem(key) {
    if (this.config && this.config.cacheLocation && this.config.cacheLocation === 'localStorage') {
      if (!this._supportsLocalStorage()) {
        this.info('Local storage is not supported')
        return null
      }

      return localStorage.getItem(key)
    }

    // Default as session storage
    if (!this._supportsSessionStorage()) {
      this.info('Session storage is not supported')
      return null
    }

    return sessionStorage.getItem(key)
  }

  /**
   * Returns true if browser supports localStorage, false otherwise.
   * @ignore
   */
  _supportsLocalStorage() {
    try {
      if (!window.localStorage) return false // Test availability
      window.localStorage.setItem('storageTest', 'A') // Try write
      if (window.localStorage.getItem('storageTest') != 'A') return false // Test read/write
      window.localStorage.removeItem('storageTest') // Try delete
      if (window.localStorage.getItem('storageTest')) return false // Test delete
      return true // Success
    } catch (e) {
      return false
    }
  }

  /**
   * Returns true if browser supports sessionStorage, false otherwise.
   * @ignore
   */
  _supportsSessionStorage() {
    try {
      if (!window.sessionStorage) return false // Test availability
      window.sessionStorage.setItem('storageTest', 'A') // Try write
      if (window.sessionStorage.getItem('storageTest') != 'A') return false // Test read/write
      window.sessionStorage.removeItem('storageTest') // Try delete
      if (window.sessionStorage.getItem('storageTest')) return false // Test delete
      return true // Success
    } catch (e) {
      return false
    }
  }

  /**
   * Returns a cloned copy of the passed object.
   * @ignore
   */
  _cloneConfig(obj) {
    if (null === obj || 'object' !== typeof obj) {
      return obj
    }

    const copy = {}
    for (const attr in obj) {
      if (obj.hasOwnProperty(attr)) {
        copy[attr] = obj[attr]
      }
    }
    return copy
  }

  /**
   * Adds the library version and returns it.
   * @ignore
   */
  _addLibMetadata() {
    // x-client-SKU
    // x-client-Ver
    return '&x-client-SKU=Js&x-client-Ver=' + this._libVersion()
  }

  /**
   * Checks the Logging Level, constructs the Log message and logs it. Users need to implement/override this method to turn on Logging.
   * @param {number} level  -  Level can be set 0,1,2 and 3 which turns on 'error', 'warning', 'info' or 'verbose' level logging respectively.
   * @param {string} message  -  Message to log.
   * @param {string} error  -  Error to log.
   */
  log(level, message, error, containsPii) {
    if (level <= Logging.level) {
      // if (!Logging.piiLoggingEnabled && containsPii) return

      const timestamp = new Date().toUTCString()
      let formattedMessage = ''

      if (this.config.correlationId)
        formattedMessage =
          timestamp +
          ':' +
          this.config.correlationId +
          '-' +
          this._libVersion() +
          '-' +
          this.CONSTANTS.LEVEL_STRING_MAP[level] +
          ' ' +
          message
      else
        formattedMessage =
          timestamp +
          ':' +
          this._libVersion() +
          '-' +
          this.CONSTANTS.LEVEL_STRING_MAP[level] +
          ' ' +
          message

      if (error) {
        formattedMessage += '\nstack:\n' + error.stack
      }

      Logging.log(formattedMessage)
    }
  }

  /**
   * Logs messages when Logging Level is set to 0.
   * @param {string} message  -  Message to log.
   * @param {string} error  -  Error to log.
   */
  error(message, error) {
    this.log(this.CONSTANTS.LOGGING_LEVEL.ERROR, message, error)
  }

  /**
   * Logs messages when Logging Level is set to 1.
   * @param {string} message  -  Message to log.
   */
  warn(message) {
    this.log(this.CONSTANTS.LOGGING_LEVEL.WARN, message, null)
  }

  /**
   * Logs messages when Logging Level is set to 2.
   * @param {string} message  -  Message to log.
   */
  info(message) {
    this.log(this.CONSTANTS.LOGGING_LEVEL.INFO, message, null)
  }

  /**
   * Logs messages when Logging Level is set to 3.
   * @param {string} message  -  Message to log.
   */
  verbose(message) {
    this.log(this.CONSTANTS.LOGGING_LEVEL.VERBOSE, message, null)
  }

  /**
   * Logs Pii messages when Logging Level is set to 0 and window.piiLoggingEnabled is set to true.
   * @param {string} message  -  Message to log.
   * @param {string} error  -  Error to log.
   */
  errorPii(message, error) {
    this.log(this.CONSTANTS.LOGGING_LEVEL.ERROR, message, error, true)
  }

  /**
   * Logs  Pii messages when Logging Level is set to 1 and window.piiLoggingEnabled is set to true.
   * @param {string} message  -  Message to log.
   */
  warnPii(message) {
    this.log(this.CONSTANTS.LOGGING_LEVEL.WARN, message, null, true)
  }

  /**
   * Logs messages when Logging Level is set to 2 and window.piiLoggingEnabled is set to true.
   * @param {string} message  -  Message to log.
   */
  infoPii(message) {
    this.log(this.CONSTANTS.LOGGING_LEVEL.INFO, message, null, true)
  }

  /**
   * Logs messages when Logging Level is set to 3 and window.piiLoggingEnabled is set to true.
   * @param {string} message  -  Message to log.
   */
  verbosePii(message) {
    this.log(this.CONSTANTS.LOGGING_LEVEL.VERBOSE, message, null, true)
  }
  /**
   * Returns the library version.
   * @ignore
   */
  _libVersion() {
    return '1.0.17'
  }
}

export default ActiveDirectoryPlugin