/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use strict";

import { browser, i18n } from "../content/es-modules/thunderbird-compat.js";
import { React, RTK, ReactRedux, PropTypes } from "../content/es-modules/ui.js";
import { TextArea, TextBox } from "./composeFields.js";

//
// Create the redux store and appropriate actions/thunks
// using Redux Toolkit (RTK)
//
const { createSlice, configureStore } = RTK;

const initialState = {
  modified: false,
};

const composeSlice = createSlice({
  name: "compose",
  initialState,
  reducers: {
    setFromDetails(state, { payload }) {
      let userModified = payload.userModified;
      delete payload.userModified;
      if (!userModified || state.modified) {
        return { ...state, ...payload };
      }
      for (let [k, v] of Object.entries(payload)) {
        if (state[k] != v) {
          return { ...state, ...payload, modified: true };
        }
      }
      // If we get here, nothing changed.
      return state;
    },
    resetStore() {
      return initialState;
    },
  },
});
export const actions = {
  initCompose(accountId, identityId) {
    return async function (dispatch) {
      // Set from to be the default account / identity.

      let accountDetail;
      if (!accountId) {
        let accounts = await browser.accounts.list();
        accountDetail = accounts[0];
      } else {
        accountDetail = await browser.accounts.get(accountId);
      }

      let identityDetail = identityId
        ? accountDetail.identities.find((i) => i.id == identityId)
        : accountDetail.identities[0];

      dispatch(
        composeSlice.actions.setFromDetails({
          userModified: false,
          from: identityDetail.email,
          identityId: identityDetail.id,
          email: identityDetail.email,
        })
      );
    };
  },
  setValue(name, value) {
    return async function (dispatch, getState) {
      let { from, to, subject, body } = getState();
      dispatch(
        composeSlice.actions.setFromDetails({
          from,
          to,
          subject,
          body,
          [name]: value,
          userModified: true,
        })
      );
    };
  },
  resetStore() {
    return async (dispatch) => {
      dispatch(composeSlice.actions.resetStore());
    };
  },
  sendMessage() {
    return async function (dispatch, getState) {
      let state = getState();
      console.log(
        await browser.convCompose.send({
          from: state.identityId,
          to: state.to,
          subject: state.subject,
          body: state.body,
        })
      );
    };
  },
};

export const store = configureStore({ reducer: composeSlice.reducer });

const INPUT_FIELDS = [
  {
    props: {
      name: "from",
      title: "message.fromHeader",
      disabled: true,
    },
    component: TextBox,
  },
  {
    props: {
      name: "to",
      title: "message.toHeader",
      disabled: false,
    },
    component: TextBox,
  },
  {
    props: {
      name: "subject",
      title: "compose.fieldSubject",
      disabled: false,
    },
    component: TextBox,
  },
  {
    props: {
      name: "body",
      disabled: false,
    },
    component: TextArea,
  },
];

function _Compose({ fieldsInfo, details, setValue, sendMessage }) {
  function onSend() {
    sendMessage();
  }

  // Warn about unloading
  function checkBeforeUnload(event) {
    if (details.modified) {
      event.preventDefault();
    }
  }

  React.useEffect(() => {
    window.addEventListener("beforeunload", checkBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", checkBeforeUnload);
    };
  });

  return (
    <div className="compose">
      {fieldsInfo.map((Item, i) => (
        <Item.component
          {...Item.props}
          key={i}
          value={details[Item.props.name]}
          onChange={setValue}
        />
      ))}
      <button id="send" onClick={onSend}>
        send
      </button>
    </div>
  );
}
_Compose.propTypes = {
  fieldsInfo: PropTypes.array.isRequired,
  setValue: PropTypes.func.isRequired,
  details: PropTypes.object.isRequired,
  sendMessage: PropTypes.func.isRequired,
};

const Compose = ReactRedux.connect((state) => ({ details: state }), {
  setValue: actions.setValue,
  sendMessage: actions.sendMessage,
})(_Compose);

/**
 * Localize `PREFS_INFO` or a single string using
 * `i18n.getMessage(...)`
 *
 * @param {(string | object[])} prefsInfo
 * @returns {(string | object[])}
 */
function localize(prefsInfo, i18n = browser.i18n) {
  if (!i18n) {
    throw new Error("`i18n` object not specified");
  }
  if (typeof prefsInfo === "string") {
    return i18n.getMessage(prefsInfo);
  }
  // If `prefsInfo` is an array, it is an array of information used
  // to render the preference setting GUI. Localize all `desc` and `title`
  // properties
  if (Array.isArray(prefsInfo)) {
    return prefsInfo.map((pref) => {
      const retProps = { ...pref.props };
      if (retProps.title) {
        retProps.title = i18n.getMessage(retProps.title);
      }
      return { ...pref, props: retProps };
    });
  }
  throw new Error("Don't know how to localize the object", prefsInfo);
}

// The entry point for the options page
export function Main() {
  const [fieldsInfo, setFieldsInfo] = React.useState(
    localize(INPUT_FIELDS, i18n)
  );

  // When the i18n library is loaded, we want to translate all
  // the localized strings.
  React.useEffect(() => {
    if (!i18n.isPolyfilled) {
      // The native `browser.i18n` is syncronous, so if we're using
      // that version, the translations have already been loaded; do
      // nothing here
      return;
    }
    i18n.isLoaded
      .then(() => {
        setFieldsInfo(localize(INPUT_FIELDS, i18n));
      })
      .catch((e) => {
        throw e;
      });
  }, []);

  return (
    <ReactRedux.Provider store={store}>
      <Compose fieldsInfo={fieldsInfo} />
    </ReactRedux.Provider>
  );
}
