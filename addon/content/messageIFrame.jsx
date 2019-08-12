/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* globals React, PropTypes */
/* exported MessageIFrame */

let index = 0;

// From https://searchfox.org/mozilla-central/rev/ec806131cb7bcd1c26c254d25cd5ab8a61b2aeb6/parser/nsCharsetSource.h
const kCharsetFromChannel = 11;

/**
 * This class exists because we need to manually manage the iframe - we don't
 * want it reloading every time a prop changes.
 *
 * We only load the iframe when we need to - when it is expanded. If it is
 * collapsed, we avoid it. This helps performance.
 *
 * The height mechanism is awkward - we generally set the height short when
 * we start to render it, then expand it to the correct height once loaded,
 * which attempts to avoid a sub-scroll.
 */
class MessageIFrame extends React.Component {
  constructor(props) {
    super(props);
    this.index = index++;
    this.currentUrl = null;
  }

  componentWillReceiveProps(nextProps) {
    let startLoad = false;
    if (this.props.neckoUrl.spec != nextProps.neckoUrl.spec && nextProps.expanded) {
      // This is a hack which ensures that the iframe is a minimal height, so
      // that when the message loads, the scroll height is set correctly, rather
      // than to the potential height of the previously loaded message.
      // TODO: Could we use a client height somewhere along the line?
      this.iframe.classList.remove("hidden");
      this.iframe.style.height = "20px";
      startLoad = true;
    }
    if (nextProps.expanded) {
      this.iframe.classList.remove("hidden");
      if (this.currentUrl != nextProps.msgUri) {
        startLoad = true;
        this.iframe.style.height = "20px";
      }
    } else {
      // Never start a load if we're going to be hidden.
      startLoad = false;
      this.iframe.classList.add("hidden");
    }
    if (startLoad) {
      this.props.dispatch({
        type: "MSG_STREAM_MSG",
        docshell: this.iframe.contentWindow.docShell,
        msgUri: nextProps.msgUri,
        neckoUrl: nextProps.neckoUrl,
      });
    }
  }

  componentDidMount() {
    const docShell = this.iframe.contentWindow.docShell;
    docShell.appType = Ci.nsIDocShell.APP_TYPE_MAIL;
    const cv = docShell.contentViewer;
    cv.hintCharacterSet = "UTF-8";
    cv.forceCharacterSet = "UTF-8";
    cv.hintCharacterSetSource = kCharsetFromChannel;
    this.registerListeners();
    if (this.props.expanded) {
      this.currentUrl = this.props.msgUri;
      this.props.dispatch({
        type: "MSG_STREAM_MSG",
        docshell: docShell,
        msgUri: this.props.msgUri,
        neckoUrl: this.props.neckoUrl,
      });
    } else {
      this.iframe.classList.add("hidden");
    }
  }

  componentWillUnmount() {
    if (!this._loadListener) {
      return;
    }
    this.iframe.removeEventListener("load", this._loadListener, {capture: true});
    delete this._loadListener;
    this.iframe.removeEventListener("load", this._domloadListener, {capture: true});
    delete this._domloadListener;
  }

  shouldComponentUpdate() {
    return false;
  }

  registerListeners() {
    if (!this._loadListener) {
      this._loadListener = this._onLoad.bind(this);
      this.iframe.addEventListener("load", this._loadListener, {capture: true});
      this._domloadListener = this._onDOMLoaded.bind(this);
      this.iframe.addEventListener("load", this._domloadListener, {capture: true});
    }
  }

  adjustHeight() {
    const iframeDoc = this.iframe.contentDocument;

    // This is needed in case the timeout kicked in after the message
    // was loaded but before we collapsed quotes. Then, the scrollheight
    // is too big, so we need to make the iframe small, so that its
    // scrollheight corresponds to its "real" height (there was an issue
    // with offsetheight, don't remember what, though).
    const scrollHeight = iframeDoc.body.scrollHeight;
    this.iframe.style.height = scrollHeight + "px";

    // So now we might overflow horizontally, which causes a horizontal
    // scrollbar to appear, which narrows the vertical height available,
    // which causes a vertical scrollbar to appear.
    let iframeStyle = window.getComputedStyle(this.iframe);
    let iframeExternalWidth = parseInt(iframeStyle.width);
    // 20px is a completely arbitrary default value which I hope is
    // greater
    if (iframeDoc.body.scrollWidth > iframeExternalWidth) {
      this.iframe.style.height = (iframeDoc.body.scrollHeight + 20) + "px";
    }
  }

  _onLoad() {
    // TODO: Should somehow trigger hooks.onMessageStreamed here.
    // TODO: Check for phishing, see also https://searchfox.org/comm-central/rev/99e635c4517ff1689d25f01b41f0753160abf7ac/mail/base/content/phishingDetector.js#50
    // TODO: Handle BIDI
    this.adjustHeight();
    // TODO: Do we need to re-check the original scroll point?
    // TODO: Send Msg loaded event
  }

  _onDOMLoaded() {
    // TODO: Implement these:
    // let iframeDoc = iframe.contentDocument;
    // self.tweakFonts(iframeDoc);
    // if (!(self._realFrom && self._realFrom.email.indexOf("bugzilla-daemon") == 0))
    //   self.detectQuotes(iframe);
    // self.detectSigs(iframe);
    // self.registerLinkHandlers(iframe);
    // self.injectCss(iframeDoc);

    this.adjustHeight();
  }

  render() {
    return (
      <iframe className={`iframe${this.index}`} type="content" src="about:blank" ref={f => this.iframe = f}/>
    );
  }
}

MessageIFrame.propTypes = {
  dispatch: PropTypes.func.isRequired,
  expanded: PropTypes.bool.isRequired,
  msgUri: PropTypes.string.isRequired,
  neckoUrl: PropTypes.object.isRequired,
};
