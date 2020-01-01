const { XPCOMUtils } = ChromeUtils.import(
  "resource://gre/modules/XPCOMUtils.jsm"
);

XPCOMUtils.defineLazyModuleGetters(this, {
  // Get various parts of the WebExtension framework that we need.
  Customizations: "chrome://conversations/content/modules/assistant.js",
  dumpCallStack: "chrome://conversations/content/modules/log.js",
  ExtensionCommon: "resource://gre/modules/ExtensionCommon.jsm",
  MessageUtils: "chrome://conversations/content/modules/message.js",
  MsgHdrToMimeMessage: "resource:///modules/gloda/mimemsg.js",
  msgUriToMsgHdr:
    "chrome://conversations/content/modules/stdlib/msgHdrUtils.js",
  Prefs: "chrome://conversations/content/modules/prefs.js",
  Services: "resource://gre/modules/Services.jsm",
  setupLogging: "chrome://conversations/content/modules/log.js",
});

let Log = setupLogging("Conversations.AssistantUI");

function prefType(name) {
  switch (name) {
    case "no_friendly_date":
    case "logging_enabled":
    case "tweak_bodies":
    case "tweak_chrome":
    case "operate_on_conversations":
    case "extra_attachments":
    case "compose_in_tab":
    case "enabled":
    case "hide_sigs": {
      return "bool";
    }
    case "expand_who":
    case "hide_quote_length": {
      return "int";
    }
    case "monospaced_senders":
    case "unwanted_recipients":
    case "uninstall_infos": {
      return "char";
    }
  }
  throw new Error(`Unexpected pref type ${name}`);
}

/* exported conversations */
var conversations = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    return {
      conversations: {
        setup() {
          MessageUtils.extensionBaseURL = context.extension.baseURL;
        },
        async setPref(name, value) {
          switch (prefType(name)) {
            case "bool": {
              Services.prefs.setBoolPref(`conversations.${name}`, value);
              break;
            }
            case "int": {
              Services.prefs.setIntPref(`conversations.${name}`, value);
              break;
            }
            case "char": {
              Services.prefs.setCharPref(`conversations.${name}`, value);
              break;
            }
          }
        },
        async getPref(name) {
          switch (prefType(name)) {
            case "bool": {
              return Services.prefs.getBoolPref(`conversations.${name}`);
            }
            case "int": {
              return Services.prefs.getIntPref(`conversations.${name}`);
            }
            case "char": {
              return Services.prefs.getCharPref(`conversations.${name}`, "");
            }
          }
          throw new Error("Unexpected pref type");
        },
        async installCustomisations(ids) {
          let uninstallInfos = JSON.parse(
            Prefs.getString("conversations.uninstall_infos")
          );
          for (const id of ids) {
            if (!(id in Customizations)) {
              Log.error("Couldn't find a suitable customization for", id);
            } else {
              try {
                Log.debug("Installing customization", id);
                let uninstallInfo = await Customizations[id].install();
                uninstallInfos[id] = uninstallInfo;
              } catch (e) {
                Log.error("Error in customization", id);
                Log.error(e);
                dumpCallStack(e);
              }
            }
          }

          if (Prefs.getString("conversations.uninstall_infos") == "{}") {
            let str = JSON.stringify(uninstallInfos);
            Log.debug("Saving JSON uninstall information", str);
            Prefs.setString("conversations.uninstall_infos", str);
          } else {
            Log.warn("Uninstall information already there, not overwriting...");
          }
        },
        async getMesageIdForUri(uri) {
          const msgHdr = msgUriToMsgHdr(uri);
          if (!msgHdr) {
            return null;
          }
          return context.extension.messageManager.convert(msgHdr).id;
        },
        async getAttachmentBody(id, partName) {
          const msgHdr = context.extension.messageManager.get(id);
          return new Promise(resolve => {
            MsgHdrToMimeMessage(
              msgHdr,
              this,
              (mimeHdr, aMimeMsg) => {
                let attachments = aMimeMsg.allAttachments;
                console.log({attachments});
                attachments = attachments.filter(
                  x => x.partName == partName
                );
                resolve(attachments[0].url);
              },
              true,
              {
                partsOnDemand: true,
                examineEncryptedParts: true,
              }
            );
          });
        },
        onOpenTab: new ExtensionCommon.EventManager({
          context,
          name: "conversation.onOpenTab",
          register(fire) {
            function callback(url) {
              return fire.async(url);
            }

            MessageUtils.setOpenTabListener(callback);
            return function() {
              MessageUtils.setOpenTabListener(null);
            };
          },
        }).api(),
      },
    };
  }
};
