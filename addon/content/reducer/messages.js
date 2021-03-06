/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { browser } from "../es-modules/thunderbird-compat.js";

const RE_BZ_BUG_LINK = /^https:\/\/.*?\/show_bug.cgi\?id=[0-9]*/;
const RE_BZ_COMMENT = /^--- Comment #\d+ from .* \d{4}.*? ---([\s\S]*)/m;

const kExpandNone = 1;
const kExpandAll = 3;
const kExpandAuto = 4;

/**
 * Used to enrich basic message data with additional information for display.
 *
 * Some of these actions happen async, or are potentially expensive, which
 * is why there are here, rather than in the individual message display functions.
 */
export let messageEnricher = new (class {
  constructor() {
    this.timeFormatter = new Intl.DateTimeFormat(undefined, {
      timeStyle: "short",
    });
    this.dateAndTimeFormatter = new Intl.DateTimeFormat(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    });
    this.pluralForm = browser.i18n.getMessage("pluralForm");
    this.numAttachmentsString = browser.i18n.getMessage(
      "attachments.numAttachments"
    );
    this.sizeUnknownString = browser.i18n.getMessage("attachments.sizeUnknown");
  }

  /**
   * Walk through each message in `msgData`, fetch and extend details about
   * each message. When the details are fetched, merge them into the
   * message object itself.
   *
   * @param {string} mode
   *   Can be "append", "replaceAll" or "replaceMsg". replaceMsg will replace
   *   only a single message.
   * @param {object[]} msgData
   *   The message details.
   * @param {object} summary
   *   The current state summary section from the store.
   */
  async enrich(mode, msgData, summary) {
    const userTags = await browser.messages.listTags();

    await Promise.all(
      msgData.map(async (message) => {
        try {
          await this._addDetailsFromHeader(message, userTags);
          await this._addDetailsFromAttachments(
            message,
            summary.prefs.extraAttachments
          );
          this._adjustSnippetForBugzilla(message);
          await messageEnricher._setDates(message, summary);
        } catch (ex) {
          console.error("Could not process message:", ex);
          message.invalid = true;
        }
      })
    );

    // Do expansion and scrolling after gathering the message data
    // as this relies on the message read information.
    if (mode == "replaceAll" || mode == "append") {
      let selectedMessages = await browser.messageDisplay.getDisplayedMessages(
        summary.tabId
      );
      if (mode == "replaceAll") {
        this._expandAndScroll(
          msgData,
          selectedMessages,
          summary.tabId,
          summary.prefs.expandWho
        );
      } else {
        this._markMsgsToExpand(
          msgData,
          selectedMessages,
          -1,
          summary.prefs.expandWho
        );
      }
    }

    msgData.filter((m) => !m.invalid);
  }

  /**
   * Figure out which messages need expanding, and which one we'll scroll to.
   *
   * @param {object[]} msgData
   *   The message details.
   * @param {object[]} selectedMessages
   *   The currently selected messages in the UI.
   * @param {number} tabId
   *   The current tab id.
   * @param {number} expandWho
   *   The value of the expandWho preference.
   */
  _expandAndScroll(msgData, selectedMessages, tabId, expandWho) {
    let focusThis = this._whereToScroll(msgData, selectedMessages);
    msgData[focusThis].scrollTo = true;
    this._markMsgsToExpand(msgData, selectedMessages, focusThis, expandWho);
  }

  /**
   * Figure out which messages we should scroll to.
   *
   * @param {object[]} msgData
   *   The message details.
   * @param {object[]} selectedMessages
   *   The currently selected messages in the UI.
   */
  _whereToScroll(msgData, selectedMessages) {
    let needsScroll = -1;

    // Conversations stub UI is only displayed when a thread is selected,
    // or a single message. If different messages across threads are selected,
    // then Thunderbird's multi-select UI is displayed. Hence, if there's more
    // than one selected message, we know that we are in a threaded selection.
    if (selectedMessages.length > 1) {
      needsScroll = msgData.length - 1;
      for (let i = 0; i < msgData.length; ++i) {
        if (!msgData[i].read) {
          needsScroll = i;
          break;
        }
      }
    } else {
      let msgId = selectedMessages[0].id;
      for (let i = 0; i < msgData.length; ++i) {
        if (msgData[i].id == msgId) {
          needsScroll = i;
          break;
        }
      }
      // I can't see why we wouldn't break at some point in the loop below, but
      //  just in case...
      if (needsScroll < 0) {
        console.error("kScrollSelected && didn't find the selected message");
        needsScroll = msgData.length - 1;
      }
    }
    return needsScroll;
  }

  /**
   * Figure out which messages we should expand and mark them.
   *
   * @param {object[]} msgData
   *   The message details.
   * @param {object[]} selectedMessages
   *   The currently selected messages in the UI.
   * @param {number} focusIndex
   *   The message in the array to focus.
   * @param {number} expandWho
   *   The value of the expandWho preference.
   */
  _markMsgsToExpand(msgData, selectedMessages, focusIndex, expandWho) {
    switch (expandWho) {
      default:
        console.error(
          false,
          `Unknown value '${expandWho}' for pref expandWho, try changing in the add-on preferences.`
        );
      // Falls through so we can default to the same as the pref and keep going.
      case kExpandAuto: {
        if (selectedMessages.length > 1) {
          // In this mode, we scroll to the first unread message (or the last
          //  message if all messages are read), and we expand all unread messages
          //  + the last one (which will probably be unread as well).
          for (let i = 0; i < msgData.length; i++) {
            msgData[i].expanded = !msgData[i].read || i == msgData.length - 1;
          }
        } else {
          // In this mode, we scroll to the selected message, and we only expand
          //  the selected message.
          for (let i = 0; i < msgData.length; i++) {
            msgData[i].expanded = i == focusIndex;
          }
        }
        break;
      }
      case kExpandAll: {
        for (const msg of msgData) {
          msg.expanded = true;
        }
        break;
      }
      case kExpandNone: {
        for (const msg of msgData) {
          msg.expanded = false;
        }
        break;
      }
    }
  }

  /**
   * Obtains the message header and adds the details of the message to it.
   *
   * @param {object} message
   *   The message to get the additional details for.
   * @param {Array} userTags
   *   An array of the current tags the user has defined in Thunderbird.
   */
  async _addDetailsFromHeader(message, userTags) {
    const messageHeader = await browser.messages.get(message.id);
    if (!messageHeader) {
      throw new Error("Message no longer exists");
    }
    const messageFolderType = messageHeader.folder.type;

    message.date = messageHeader.date.getTime();

    message.isDraft = messageFolderType == "drafts";
    message.isJunk = messageHeader.junk;
    message.isOutbox = messageFolderType == "outbox";
    message.read = messageHeader.read;
    message.shortFolderName = messageHeader.folder.name;
    message.subject = messageHeader.subject;
    message.starred = messageHeader.flagged;

    message.tags = messageHeader.tags.map((tagKey) => {
      // The fallback here shouldn't ever happen, but just in case...
      const tagDetails = userTags.find((t) => t.key == tagKey) || {
        color: "#FFFFFF",
        name: "unknown",
      };
      return {
        color: tagDetails.color,
        key: tagDetails.key,
        name: tagDetails.tag,
      };
    });

    // Only need to do this if the message is not in the current view.
    if (!message.inView) {
      message.folderName = await browser.conversations.getFolderName(
        message.id
      );
    }
  }

  /**
   * Obtains attachment details and adds them to the message.
   *
   * @param {object} message
   *   The message to get the additional details for.
   * @param {boolean} extraAttachments
   *   Whether or not the user wants to display extra attachments.
   */
  async _addDetailsFromAttachments(message, extraAttachments) {
    if (message.fromGloda && extraAttachments) {
      message.needsLateAttachments = true;
    }

    let attachments = message.attachments;
    let l = attachments.length;
    let newAttachments = [];

    for (let i = 0; i < l; i++) {
      const att = attachments[i];
      // This is bug 630011, remove when fixed
      let formattedSize = this.sizeUnknownString;
      // -1 means size unknown
      if (att.size != -1) {
        formattedSize = await browser.conversations.formatFileSize(att.size);
      }

      // We've got the right data, push it!
      newAttachments.push({
        size: att.size,
        contentType: att.contentType,
        formattedSize,
        isExternal: att.isExternal,
        name: att.name,
        partName: att.partName,
        url: att.url,
        anchor: "msg" + message.initialPosition + "att" + i,
      });
    }
    message.attachments = newAttachments;
    message.attachmentsPlural = l
      ? await browser.conversations.makePlural(
          this.pluralForm,
          this.numAttachmentsString,
          l
        )
      : "";
  }

  /**
   * Adjusts a message snippet for bugzilla - this removes information which
   * isn't very useful in the summary, and simplifies it.
   *
   * @param {object} message
   *   The message for which to simplify the snippet.
   */
  _adjustSnippetForBugzilla(message) {
    if (!message.type == "bugzilla") {
      return;
    }

    let snippet = message.snippet;

    let m = snippet.match(RE_BZ_BUG_LINK);
    if (m?.[0]) {
      snippet = snippet.substring(m[0].trim().length);
    }
    m = snippet.match(RE_BZ_COMMENT);
    if (m?.length && m[1].trim().length) {
      snippet = m[1];
    }

    message.snippet = snippet;
  }

  /**
   * A formatting function that uses Services.intl
   * to format a date just like in the message list
   *
   * @param {Date} date a javascript Date object
   * @returns {string} a string containing the formatted date
   */
  dateAsInMessageList(date) {
    const now = new Date();
    // Is it today?
    const isToday =
      now.getFullYear() == date.getFullYear() &&
      now.getMonth() == date.getMonth() &&
      now.getDate() == date.getDate();

    const formatter = isToday ? this.timeFormatter : this.dateAndTimeFormatter;
    return formatter.format(date);
  }

  /**
   * Sets dates in a message for display, setting according to the
   * no_friendly_date preference.
   *
   * @param {object} message
   *   The message to set the dates for.
   * @param {object} summary
   *   The current summary details from the store state.
   */
  async _setDates(message, summary) {
    let date = new Date(message.date);
    if (summary.prefs.noFriendlyDate) {
      message.date = this.dateAsInMessageList(date);
      message.fullDate = "";
    } else {
      message.date = await browser.conversations.makeFriendlyDateAgo(
        date.getTime()
      );
      message.fullDate = this.dateAsInMessageList(date);
    }
  }
})();
