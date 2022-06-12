(function() {
  'use strict';

  const ENV_PROD = 'prod';
  const ENV_STAGING = 'staging';
  const ENV_LOCAL = 'local';

  const DEBUG_MODE_URL_QUERY_PARAMETER = 'debug';
  const ENVIRONMENT_URL_QUERY_PARAMETER = 'env';
  const LOCAL_STORAGE_KEY_CHAT_ID = "grispi.chat.chatId";
  const LOCAL_STORAGE_KEY_LAST_MESSAGE_TIME = "grispi.chat.lastMessageTime"

  const EVENTS = {
    READY: 'grispi.chat.request.ready',
    INIT: 'grispi.chat.response.init',
    NEW_CHAT_SESSION: 'grispi.chat.request.newChatSession',
    LAST_MESSAGE_TIME: 'grispi.chat.request.lastMessageTime',
    UNREAD_MESSAGES_COUNT: 'grispi.chat.request.unreadMessageCount'
  };

  const {inDebugMode, tenantId, environment} = extractSearchParamsInSrc();

  const GRISPI_API_URL = grispiApiUrl(environment);
  const CHAT_POPUP_URL = chatPopupIframeUrl(environment);

  /**
   * The customer's own site url (3rd party website). The one that the end user browses.
   */
  const HOST_URL = location.href;

  const authKey = uuidv4();
  const iframeUrlDebugParam = inDebugMode ? '&debug=true' : '';
  const iframeUrl = `${CHAT_POPUP_URL}?url=${HOST_URL}&auth=${authKey}${iframeUrlDebugParam}`

  function style() {
    let startButtonIconSize;
    let closeButtonIconSize;
    if (window.matchMedia("(max-width: 500px)").matches) {
      startButtonIconSize = 2;
      closeButtonIconSize = 1.5;
    } else {
      startButtonIconSize = 3;
      closeButtonIconSize = 2;
    }
    return `
    <style id="grispiChatJsStyle">
    #grispiChatStartIcon::before {
      content: "";
      width: ${startButtonIconSize}rem;
      height: ${startButtonIconSize}rem;
      position: relative;
      z-index: 100000;
      color: #f8f9f9;
      background-image: url(https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/chat/default/48px.svg);
      background-size: contain;
      display: block;
      filter: invert(1);
    }

    #grispiChatCloseIcon::before {
      content: "";
      width: ${closeButtonIconSize}rem;
      height: ${closeButtonIconSize}rem;
      position: relative;
      z-index: 100000;
      color: #f8f9f9;
      background-image: url(https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/close/default/48px.svg);
      background-size: contain;
      display: block;
      filter: invert(1);
    }
    </style>
    `;
  }

  function template() {
    let startButtonHeight;
    let startButtonWidth;
    let frameHeight;
    let frameWidth;
    if (window.matchMedia("(max-width: 500px)").matches) {
      startButtonHeight = 50;
      startButtonWidth = 50;
      frameWidth = 350;
      frameHeight = 600;
    } else {
      startButtonHeight = 80;
      startButtonWidth = 80;
      frameWidth = 400;
      frameHeight = 650;
    }
    const containerStyle = `
    position: fixed;
    bottom: 10px;
    right: 10px;
    border: 0;
    height: ${frameHeight}px;
    width: ${frameWidth}px;
    border: 1px solid black;
    background: #632d91;
    display: none;
    flex-direction: column;
  `;

    const headerStyle = `
    height: 50px;
    display: flex;
    flex-grow: 0;
    align-content: center;justify-content: center;align-items: stretch;
  `;

    const headerTextStyle = `
    font-family: 'Montserrat', sans-serif;
    color:#f8f9f9;
		flex-grow: 1;
    display: flex;
    align-items: center;
    padding-left: 10px;
  `;

    const grispiCloseButtonStyle = `
  	cursor: pointer;
    border: 0px solid #3498db;
    background-color: transparent;
    height: 50px;
    color: #f8f9f9;
    padding-right:10px
  `;

    const iframeStyle = `
    flex-grow: 2;
  `;

    const grispiChatStartContainerStyle = `
  	position: fixed;
    bottom: 20px;
    right: 20px;
    border: 0;
    background-color: #632d91	;
    display: flex;
    flex-direction: column;
    cursor: pointer;
    justify-content: center;
    align-items: center;
    height: ${startButtonHeight}px;
    width: ${startButtonWidth}px;
  `;
    return `
      <section id="grispiChatContainer" style="${containerStyle}">
        <div id="grispiPopupHeader" style="${headerStyle}">
          <span id="grispiChatTitle" style="${headerTextStyle}"></span>
          <button id="grispiCloseButton" style="${grispiCloseButtonStyle}"><span id="grispiChatCloseIcon">
      </span></button>
        </div>
        <iframe id="grispiIframe" src="${iframeUrl}" style="${iframeStyle}" referrerpolicy="origin"></iframe>
      </section>
      
      <section id="grispiChatStartContainer" style="${grispiChatStartContainerStyle}">
        <span id="grispiChatStartIcon"></span>
      </section>
    `;
  }

  document.head.insertAdjacentHTML('beforeend', style());
  document.body.insertAdjacentHTML('beforeend', template());
  const iframe = document.getElementById("grispiIframe");
  const popup = document.getElementById('grispiChatContainer');
  const headerTitleElem = document.getElementById('grispiChatTitle');
  const closeBtn = document.getElementById('grispiCloseButton');
  const startBtn = document.getElementById('grispiChatStartContainer');
  closeBtn.onclick = () => {popup.style.display = 'none'; startBtn.style.display = 'flex'};
  startBtn.onclick = () => {popup.style.display = 'flex'; startBtn.style.display = 'none'};

  const preferences = fetch(`${GRISPI_API_URL}/chat/preferences`, {
    method:"GET",
    mode:"cors",
    headers: {
      "tenantId": tenantId
    }
  });

  const onlineStatus = async () => {
    const response = await fetch(`${GRISPI_API_URL}/chat/status`, {
      method:"GET",
      mode:"cors",
      headers: {
        "tenantId": tenantId
      }
    })
    return await response.json()
  }

  // listen for ready message then send init message when preferences promise is fullfilled
  window.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (e) {
      console.log('Cannot parse event data', event.data);
      return;
    }
    const {auth, data, type} = message;
    console.debug("event came", type, auth)
    if (auth !== authKey) {
      console.error("Window is not authenticated!");
      return;
    }
    if (type === EVENTS.READY) {
      preferences // TODO error handling
        .then(response => response.json())
        .then((parsedPreferences) => {
          headerTitleElem.insertAdjacentText("afterbegin",parsedPreferences.text.title)
          const initMessage = JSON.stringify({
            type: EVENTS.INIT,
            auth: authKey,
            data: {
              lastMessageTime: window.localStorage.getItem(LOCAL_STORAGE_KEY_LAST_MESSAGE_TIME) ?? undefined,
              tenantId: tenantId,
              chatId: window.localStorage.getItem(LOCAL_STORAGE_KEY_CHAT_ID) ?? undefined,
              preferences: parsedPreferences,
              online: onlineStatus()
            }
          });

          event.source.postMessage(initMessage, event.origin);//FIXME use iframe.src instea of event.origin
        });
    } else if (type === EVENTS.NEW_CHAT_SESSION) {
      window.localStorage.setItem(LOCAL_STORAGE_KEY_CHAT_ID, data.chatId)
    } else if (type === EVENTS.LAST_MESSAGE_TIME) {
      window.localStorage.setITEM(LOCAL_STORAGE_KEY_LAST_MESSAGE_TIME, data.lastMessageTime)
    } else if (type === EVENTS.UNREAD_MESSAGES_COUNT) {
      //TODO add numbers to button to show
    }
  });

  function extractSearchParamsInSrc() {

    if (!document.currentScript || !document.currentScript.src) {
      console.error(`'document.currentScript' is not available!`);
      return {};
    }

    const searchParams = new URL(document.currentScript?.src).searchParams;

    const debugModeParam = searchParams.get(DEBUG_MODE_URL_QUERY_PARAMETER) || '';
    return {
      tenantId: searchParams.get('tenantId'),
      inDebugMode: debugModeParam.toLowerCase() === 'true',
      environment: parseEnv(searchParams.get(ENVIRONMENT_URL_QUERY_PARAMETER)),
    };
  }

  function uuidv4() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
  }

  function parseEnv(env) {
    if (!env || env.trim().length === 0) return ENV_PROD;
    if (env.toLowerCase() === ENV_STAGING) return ENV_STAGING;
    if (env.toLowerCase() === ENV_LOCAL) return ENV_LOCAL;
  }

  function grispiApiUrl(env) {
    switch (env) {
      case ENV_LOCAL: return 'http://localhost:8080';
      case ENV_STAGING: return 'https://api.grispi.dev';
      case ENV_PROD: return 'https://api.grispi.com';
    }
  }

  function chatPopupIframeUrl(env) {
    switch (env) {
      case ENV_LOCAL: return 'http://localhost:3000';
      case ENV_STAGING: return 'https://chat-ui.grispi.dev';
      case ENV_PROD: return 'https://chat-ui.grispi.com';
    }
  }

})();
