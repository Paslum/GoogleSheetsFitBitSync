// Doesn't require special permission, just follow setup and authorize
// Original script by John McLaughlin (loghound@gmail.com)
// Modifications - Simon Bromberg (http://sbromberg.com)
// Modifications - Mark Leavitt (PDX Quantified Self organizer) www.markleavitt.com
// Modifications 2020 - Jozef Jarosciak - joe0.com
// Modifications 2022 - Josh Kybett - JKybett.uk
//    -Replaced discontinued UiApp code to use HtmlService instead.
//    -Replace deprecated v1 FitBit API with current standard v2 FitBit API
//    -Now fetches data using daily summaries rather than per-item ranges to avoid hitting API limits when getting single-day data.
//    -Adapted to get data for more features of FitBit.
//    -Friendlier setup UI.
// Modifications 2024 - Tim Goodwyn - timgoodwyn.me.uk
// Modifications 2025 - Paslum - paslum.de
//    - Added some APIs
//    - Added UI styling
//    - Rewrote some code to make it more readable + some reusability
//    - Added Auto-Sync
// Current version on GitHub: https://github.com/JKybett/GoogleFitBit/blob/main/FitBit.gs
//
// This is a free script: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.
//
// Copyright (c) 2022 JKybett, Tim Goodwyn and other contributors

/*
 * Do not change these key names. These are just keys to access these properties once you set them up by running the Setup function from the Fitbit menu
 */
const CONSUMER_KEY_PROPERTY_NAME = "fitbitConsumerKey";
const CONSUMER_SECRET_PROPERTY_NAME = "fitbitConsumerSecret";

const SERVICE_IDENTIFIER = "fitbit"; // usually do not need to change this either

/* * * * * * * * * * * API Definitions * * * * * * * * * * * * */

/**
 * Based on https://dev.fitbit.com/build/reference/web-api/
 * @typedef {object} APIDefinition
 * @property {} fields
 * @property {} scope
 * @property {} url
 *
 * format: field -> path
 * @type { [api: string]: APIDefinition }
 */
const apiDefinitions = {
  activeZoneMinutes: {
    fields: {
      "activities-active-zone-minutes": {
        0: {
          value: [
            "activeZoneMinutes",
            "fatBurnActiveZoneMinutes",
            "cardioActiveZoneMinutes",
            "peakActiveZoneMinutes",
          ],
        },
      },
    },
    scope: "activity",
    url: "https://api.fitbit.com/1/user/-/activities/active-zone-minutes/date/[date]/1d.json",
  },
  activities: {
    fields: {
      summary: [
        "activityCalories",
        "caloriesBMR",
        "caloriesOut",
        "elevation",
        "fairlyActiveMinutes",
        "floors",
        "lightlyActiveMinutes",
        "marginalCalories",
        "sedentaryMinutes",
        "steps",
        "veryActiveMinutes",
      ],
    },
    scope: "activity",
    url: "https://api.fitbit.com/1/user/-/activities/date/[date].json",
  },
  activitiesHeart: {
    fields: {
      "activities-heart": {
        0: {
          value: ["restingHeartRate"],
        },
      },
    },
    scope: "heartrate",
    url: "https://api.fitbit.com/1/user/-/activities/heart/date/[date]/1d.json",
  },
  breathingRate: {
    fields: {
      br: {
        0: {
          value: ["breathingRate"],
        },
      },
    },
    scope: "respiratory_rate",
    url: "https://api.fitbit.com/1/user/-/br/date/[date].json",
  },
  cardioScore: {
    fields: {
      cardioScore: {
        0: {
          value: ["vo2Max"],
        },
      },
    },
    scope: "cardio_fitness",
    url: "https://api.fitbit.com/1/user/-/cardioscore/date/[date].json",
  },
  heartRateVariability: {
    fields: {
      hrv: {
        0: {
          value: ["dailyRmssd", "deepRmssd"],
        },
      },
    },
    scope: "heartrate",
    url: "https://api.fitbit.com/1/user/-/hrv/date/[date].json",
  },
  sleep: {
    fields: {
      sleep: {
        // Limitation: currently this API definition structure means it's not possible to mix scalar values at one level with
        // nested values deeper - at the moment we get away with it.
        // TODO: cope with multiple sleep logs in a day - want the main sleep if there is one
        // TODO: array entries in levels:data
        0: ["duration", "endTime", "startTime","efficiency"],
      },
      summary: {
        stages: ["deep", "light", "rem", "wake"],
      },
    },
    scope: "sleep",
    url: "https://api.fitbit.com/1.2/user/-/sleep/date/[date].json",
  },
  weight: {
    fields: {
      weight: {
        0: ["bmi","weight"],
      },
    },
    scope: "weight",
    url: "https://api.fitbit.com/1/user/-/body/log/weight/date/[date].json",
  },
  spo2: {
    fields: {
      value: ["avg","min","max"],
    },
    scope: "oxygen_saturation",
    url: "https://api.fitbit.com/1/user/-/spo2/date/[date].json",
  },
  fat: {
    fields: {
      fat: {
        0: ["fat"],
      },
    },
    scope: "weight",
    url: "https://api.fitbit.com/1/user/-/body/log/fat/date/[date].json",
  },
};

// Assumes that leaf field names are unique between API calls (which is true in the existing version)
// May need to introduce addressing by path if it's ambiguous
function getFieldNames(obj) {
  if (typeof obj !== 'object' || obj === null) return [];
  if (Array.isArray(obj)) {
    return obj;
  } else {
    const fieldNames = [];
    Object.keys(obj).forEach((k) => {
      fieldNames.push(...getFieldNames(obj[k]));
    });
    return fieldNames;
  }
}


const allFields = Object.values(apiDefinitions)
  .map(({ fields }) => getFieldNames(fields))
  .reduce((prev, current) => {
    prev.push(...current);
    return prev;
  }, []);

/* * * * * * * * * * * End of API Definitions * * * * * * * * * * * * */

function getProperty(key) {
  Logger.log("get property " + key);
  return PropertiesService.getScriptProperties().getProperty(key);
}
/*

*/
function setProperty(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
}

function setSheet(sheet) {
  setProperty("sheetID", sheet ? sheet.getSheetId().toString() : '');
  setProperty("spreadSheetID", sheet ? sheet.getParent().getId().toString() : '');
}

const manageSpreadsheet = {
  spreadSheetId : getProperty("spreadSheetID"),
  cell: function(row, column) {
    const cellString = `R${row}C${column}`;
    const doc = SpreadsheetApp.openById(this.spreadSheetId);
    return {
      set: function(value) {
        try {
          this.setBackground("green");
          doc.getRange(cellString).setValue(value);
          console.info(`Cell R${cellString} has been set`);
          this.setBackground("white");
        } catch (err) {
          console.error(`Cell ${cellString} could not be set: ${err}`);
        };
      },
      get: function() {
      },
      setBackground: function(color) {
        doc.getRange(cellString).setBackground(color);
      }
    };
  },
  status : {
    set: function(status  = "unknown") {
      manageSpreadsheet.cell(3,2).set(status);
    },
    get: function(){}
  },
};

const consumer = {
  key: {
    set: function(key) {
      setProperty(CONSUMER_KEY_PROPERTY_NAME, key);
    },
    get: function() {
      return getProperty(CONSUMER_KEY_PROPERTY_NAME) || '';
    }
  },
  secret: {
    set: function(secret) {
      setProperty(CONSUMER_SECRET_PROPERTY_NAME, secret);
    },
    get: function() {
      return getProperty(CONSUMER_SECRET_PROPERTY_NAME) || '';
    }
  }
};

/*

*/
function getSheet() {
  try {
    var spreadSheetID = getProperty("spreadSheetID");
    console.log(spreadSheetID);
    var spreadSheet = SpreadsheetApp.openById(spreadSheetID.toString());
    var sheetID = getProperty("sheetID");
    var sheet = spreadSheet.getSheets().filter(function (s) {
      return s.getSheetId().toString() === sheetID.toString();
    })[0];
    return sheet;
  } catch (error) {
    return null;
  }
}

/*

*/


function defaultHTML(head, body) {
  return `
  <!DOCTYPE html>
  <html>
    <head>
    <style>
      input, select {
          border-style: solid;
          border-color: #00B0B9;
          border-radius: 12px;
          border-width: medium;
          backgroud-color: #86F9FF;
          padding: 6px 12px;
          margin: 2px;
      }
    </style>
      ${head}
    </head>
    <body>
      ${body}
      </br></br>
      <div style='text-align: right;font-style: italic;'>By <a href='https://jkybett.uk' target='_blank'>JKybett</a></div>
    </body>
  </html>
  `;
}
/*

*/
function isConfigured() {
  return consumer.key.get() && consumer.secret.get();
}

function clearService() {
  OAuth2.createService(SERVICE_IDENTIFIER)
    .setPropertyStore(PropertiesService.getUserProperties())
    .reset();
  consumer.key.set("");
  consumer.secret.set("");
  setSheet(null);
}

function getScopes() {
  const scopesDict = {
    profile: true,
    settings: true,
  };
  Object.values(apiDefinitions).forEach((def) => {
    if (def.scope) {
      scopesDict[def.scope] = true;
    }
  });
  return Object.keys(scopesDict).join(" ");
}

function getFitbitService() {
  // Create a new service with the given name. The name will be used when
  // persisting the authorized token, so ensure it is unique within the
  // scope of the property store
  if (!isConfigured()) {
    setup();
    return;
  }

  return (
    OAuth2.createService(SERVICE_IDENTIFIER)

      // Set the endpoint URLs, which are the same for all Google services.
      .setAuthorizationBaseUrl("https://www.fitbit.com/oauth2/authorize")
      .setTokenUrl("https://api.fitbit.com/oauth2/token")

      // Set the client ID and secret, from the Google Developers Console.
      .setClientId(getConsumerKey())
      .setClientSecret(getConsumerSecret())

      // Set the name of the callback function in the script referenced
      // above that should be invoked to complete the OAuth flow.
      .setCallbackFunction("authCallback")

      // Set the property store where authorized tokens should be persisted.
      .setPropertyStore(PropertiesService.getUserProperties())
      .setScope(getScopes())
      // but not desirable in a production application.
      //.setParam('approval_prompt', 'force')
      .setTokenHeaders({
        Authorization:
          "Basic " +
          Utilities.base64Encode(getConsumerKey() + ":" + getConsumerSecret()),
      })
  );
}

function submitData(form) {
  switch (form.task) {
    case "setup":
      saveSetup(form);
      break;
    case "sync":
      syncDate(new Date(form.year, form.month - 1, form.day));
      break;
    case "syncMany":
      syncMany(
        new Date(form.firstYear, form.firstMonth - 1, form.firstDay),
        new Date(form.secondYear, form.secondMonth - 1, form.secondDay)
      );
      break;
    case "BackToFitBitAPI":
      firstRun();
      break;
    case "FitBitAPI":
      setup();
      break;
    case "addTrigger":
      manageTrigger.add(form);
      break;
    //case "credits" : credits();break;
  }
}

// function saveSetup saves the setup params from the UI
function saveSetup(e) {
  //problemPrompt(e.spreadSheetID);
  var doc = SpreadsheetApp.openById(e.spreadSheetID);
  if (parseInt(e.newSheet) > 0) {
    if (e.sheetID.length < 1) {
      e.sheetID = "FitbitData";
    }
    doc = doc.insertSheet(e.sheetID.toString());
    e.sheetID = doc.getSheetId();
  }
  var doc = SpreadsheetApp.openById(e.spreadSheetID);
  doc = doc.getSheets().filter(function (s) {
    return s.getSheetId().toString() === e.sheetID.toString();
  })[0];
  //problemPrompt("'"+e.sheetID+"'");
  setSheet(doc);
  manageSpreadsheet.status.set("Working");
  manageSpreadsheet.cell(2,2).set(new Date(e.year, e.month - 1, e.day));
  console.log(e);
  consumer.key.set(e.consumerKey);
  consumer.secret.set(e.consumerSecret);
  var i = 2;
  var cell = doc.getRange("R4C2");
  var titles = [];
  var wanted = [];
  while (!cell.isBlank()) {
    titles.push(cell.getValue());
    cell = doc.getRange("R4C" + ++i);
    wanted.push(false);
  }
  var index = -1;
  for (const [key, value] of Object.entries(e.loggables)) {
    index = titles.findIndex((e) => {
      return e == value;
    });
    if (index < 0) {
      titles.push(value);
      wanted.push(true);
    } else {
      wanted[index] = true;
    }
  }
  for (i = 0; i < wanted.length; i++) {
    if (!wanted[i]) {
      titles[i] = "";
    }
  }
  i = 0;
  for (const [key, value] of Object.entries(titles)) {
    manageSpreadsheet.cell(4,2+i).set(value);
    i++;
  }
  manageSpreadsheet.cell(1,1).set("Sheet last synced: never");
  manageSpreadsheet.cell(2,1).set("Start Date:");
  manageSpreadsheet.cell(3,1).set("Status:");
  manageSpreadsheet.cell(4,1).set("Date");
  authWindow();
  manageSpreadsheet.status.set("Ready");
}
/*

*/
function sync() {
  syncDate();
}
function syncYesterday() {
  var yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  syncDate(yesterday);
}

/*

*/
function syncMany(firstDate, secondDate) {
  var dayMil = 1000 * 60 * 60 * 24;
  days = Math.round((secondDate - firstDate) / dayMil);
  console.log(days);
  if (days > 30) {
    problemPrompt(
      "Fitbit doesn't like sending too much data too quickly, so anything more than 30 days may cause issues.</br>If this stops working partway through, wait about an hour before trying again.",
      "Warning!"
    );
  }
  if (days == 0) {
    sync(secondDate);
  }
  if (days < 0) {
    problemPrompt(
      "I think you got your dates the wrong way round. Please try again!"
    );
  } else {
    var curDate = secondDate;
    while (Math.round((curDate - firstDate) / dayMil) >= 0) {
      syncDate(curDate);
      curDate.setDate(curDate.getDate() - 1);
    }
  }
}

/*
  function sync() is called to download all desired data from Fitbit API to the spreadsheet
*/
function syncDate(date = new Date()) {
  manageSpreadsheet.status.set("Working");
  var dateString = Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var doc = getSheet();
  var workingRow = rowFromDate(date);
  if (workingRow < 5) {
    problemPrompt(
      "The date given is before your defined Earliest Date. Extending before this date is not supported and causes problems."
    );
    manageSpreadsheet.status.set("Ready");
    return;
  }
  manageSpreadsheet.status.set("Working row: " + workingRow);

  doc.setFrozenRows(4);
  manageSpreadsheet.cell(1,1).set("Sheet last synced: " + new Date());
  manageSpreadsheet.cell(4,1).set("Date");
  var options = {
    headers: {
      Authorization: "Bearer " + getFitbitService().getAccessToken(),
      method: "GET",
    },
  };
  manageSpreadsheet.cell(workingRow,1).set(dateString);

  const allFieldsUsed = doc.getRange("4:4").getValues()[0];

  // For each API definition above, check whether any fo the fields are used and fetch from the API if so
  Object.entries(apiDefinitions).forEach(([apiName, apiDefinition]) => {
    const fieldNames = getFieldNames(apiDefinition.fields);
    const apiFieldsNeeded = Object.fromEntries(
      fieldNames
        .filter((field) => allFieldsUsed.includes(field))
        .map((field) => [field, allFieldsUsed.indexOf(field)])
    );
    if (Object.keys(apiFieldsNeeded).length > 0) {
      console.log(`Fetching ${apiName}...`);
      const result = UrlFetchApp.fetch(
        apiDefinition.url.replace("[date]", dateString),
        options
      );
      const stats = JSON.parse(result.getContentText());
      console.log(stats);
      console.log(`Logging ${apiName}...`);

      forEachRequiredField(
        stats,
        apiDefinition.fields,
        apiFieldsNeeded,
        (fieldName, column, value) => {
          console.log(`log ${fieldName}, ${column}, ${value}`);
          if (column >= 0) {
            manageSpreadsheet.cell(workingRow,column+1).set(value);
          }
        }
      );
    }
  });
  manageSpreadsheet.status.set("Ready");
}

const manageTrigger = {
  add: function(form) {
    manageSpreadsheet.status.set("Working");

    switch (form.type) {
      case "daily":
        ScriptApp.newTrigger(form.function)
        .timeBased()
        .everyDays(1)
        .atHour(form.time)
        .create();
        manageSpreadsheet.status.set("Ready");
        break;
    }
  }
};


/*
  Calculates which row should be used for a particular date's data based on the user-provided earliest date that data can be from.
*/
function rowFromDate(date) {
  const dayMil = 86400000;
  var firstDay = getSheet().getRange("R2C2").getValue();
  date = date - firstDay;
  date = (date - (date % dayMil)) / dayMil;
  return date + 5;


}

function forEachRequiredField(statsObj, fieldObj, apiFieldsNeeded, fieldFn) {
  if (Array.isArray(fieldObj)) {
    fieldObj.forEach((field) => {
      if (apiFieldsNeeded[field] !== undefined) {
        fieldFn(field, apiFieldsNeeded[field], statsObj[field]);
      }
    });
  } else {
    Object.keys(fieldObj).forEach((field) => {
      if (statsObj[field]) {
        forEachRequiredField(
          statsObj[field],
          fieldObj[field],
          apiFieldsNeeded,
          fieldFn
        );
      }
    });
  }
}

/*

*/

function firstRun() {
  const doc = SpreadsheetApp.getActiveSpreadsheet();
  const headHTML = `
  <style>
      label, input {
      width:95%;
      }
      .radio {
        width:initial;
      }
      .box {
        border-style: solid;
        padding: 5px;
        margin-bottom: 10px;
      }
      #hidden {
        display: none;
      }
    </style>
  `;
  const bodyHTML = `
  Go to <a href="https://dev.fitbit.com/apps/new">https://dev.fitbit.com/apps/new</a></br></br>
    Login and register a new app using the following details:</br></br>
    <div class="box" id="hider">
      Only the options that must have specific values are shown below.</br>
      <a href="#" onclick="document.getElementById('hidden').style.display='block';document.getElementById('hider').style.display='none';return false;">
        Click here
      </a> for example data you can copy and paste into the other fields.
    </div>
    <div class="box" id="hidden">
      These options can be filled with different data. This is only an example.</br>
      You can
      <a href="#" onclick="document.getElementById('hider').style.display='block';document.getElementById('hidden').style.display='none';return false;">
        hide these options
      </a> if you want.
      </br></br>
      <label>Application Name: </label></br><input type="text" value="Export to Google Spreadsheet" readonly></br></br>
      <label>Description: </label></br><input type="text" value="Exports to Google Spreadsheet" readonly></br></br>
      <label>Application Website URL: </label></br><input type="text" value="https://docs.google.com/" readonly></br></br>
      <label>Organization: </label></br><input type="text" value="Me" readonly></br></br>
      <label>Organization Website URL: </label></br><input type="text" value="https://docs.google.com/" readonly></br></br>
      <label>Terms of Service URL: </label></br><input type="text" value="https://docs.google.com/" readonly></br></br>
      <label>Privacy Policy URL: </label></br><input type="text" value="https://docs.google.com/" readonly></br></br>
    </div>
    <div class="box">
      These options <b>must</b> be filled with the following data.</br></br>
      <label>OAuth 2.0 Application Type: </label></br>
      <input class="radio" type="radio" name="appType" id="Server" disabled>
      <label class="radio" for="Server">Server</label>
      <input class="radio" type="radio" name="appType" id="Client" disabled>
      <label class="radio" for="Client">Client</label>
      <input class="radio" type="radio" name="appType" id="Personal" checked>
      <label class="radio" for="Personal">Personal</label></br></br>
      <label>Redirect URL: </label></br><input type="text" value="https://script.google.com/macros/d/${ScriptApp.getScriptId()}/usercallback" readonly></br></br>
      <label>Default Access Type: </label></br>
      <input class="radio" type="radio" name="accessType" id="RWr" checked>
      <label class="radio" for="RWr">Read & Write</label>
      <input class="radio" type="radio" name="accessType" id="ROn" disabled>
      <label class="radio" for="ROn">Read-Only</label></br></br>
    </div>
    Once you have accepted the terms and conditions and clicked "register", make a note of the following details on the next page:</br>
    <ul>
      <li><b>OAuth 2.0 Client ID</b></li>
      <li><b>Client Secret</b></li>
    </ul>
    Then click the button below to move on to the next step:
    <form id="form">
      <input type="hidden" id="task" name="task" value="FitBitAPI">
      <input class="normWid" type="button" value="Next" onclick="google.script.run.withSuccessHandler(function(value){}).submitData(form);document.getElementById('done').style.display = 'block';">
    </form>
    <p id="done" style="display:none;">Please wait!</p>
  `;
  const app = HtmlService.createHtmlOutput().setTitle("Setup Fitbit App").setContent(defaultHTML(headHTML, bodyHTML));
  doc.show(app);
}

/*

*/
function setup() {
  var doc = SpreadsheetApp.getActiveSpreadsheet();
  var selected;
  var sheets = doc.getSheets();
  var selectSheet = doc.getActiveSheet();
  var earliestDate = new Date();
  if (getSheet() != null) {
    selectSheet = getSheet();
    earliestDate = getSheet().getRange("R2C2").getValue();
  }
  function getSheets() {
    sheetsHTML = '';
    for (var resource in allFields) {
      selected = allFields.indexOf(allFields[resource]) > -1 ? " selected" : "";
      sheetsHTML += `
        <option value="${allFields[resource]}" ${selected}>
          ${allFields[resource]}
        </option>
      `;
    }
    return sheetsHTML;
  }
  function getLoggables() {
    loggablesHTML = '';
    if (sheets.length > 0) {
      for (var i = 0; i < sheets.length; i++) {
        selected = sheets[i].getSheetId() == selectSheet.getSheetId() ? " selected" : "";
        loggablesHTML += `
        <option value="${sheets[i].getSheetId()}" ${selected}>
          ${sheets[i].getName()}
        </option>
      `;
      }
    }
    return loggablesHTML;
  }

  var headHTML = `
    <style>
      label, input, select {
        width: 45%;
        display: inline-block;
        vertical-align: top;
      }
      label {

      }
      input, select {
        text-align: right;
      }
      .half {
        width: 50%;
      }
      .full {
        width: 100%;
      }
      .right {
        text-align: right;
        margin-right: 0px;
      }
      .normWid {
        width: initial;
      }
      .sheetName {
        visibility: hidden;
      }
    </style>
  `;
  var bodyHTML = `
    <form id="backForm">
      <input type="hidden" id="task" name="task" value="BackToFitBitAPI">
      <center>
        <input class="normWid" type="button" value="<<< Setup FitBit App" onclick="google.script.run.withSuccessHandler(function(value){}).submitData(backForm);">
      </center>
    </form>
    <form id="form">
      <input type="hidden" id="task" name="task" value="setup">
      <input type="hidden" id="spreadsheetID" name="spreadSheetID" value="${doc.getId().toString()}">
      <label class="normWid">Script ID: </label>
      <label class="normWid right">
        ${ScriptApp.getScriptId()}
      </label></br></br>
      <label>Fitbit OAuth 2.0 Client ID:*</label>
      <input type="text" id="consumerKey" name="consumerKey" value="${getConsumerKey()}"></br></br>
      <label>Fitbit OAuth Consumer Secret:*</label>
      <input type="text" id="consumerSecret" name="consumerSecret" value="${getConsumerSecret()}"></br></br>
      <label>Earliest Date (year-month-day): </label>
      <input class="normWid" type="text" maxlength="4" size="4" id="year" name="year" value="${earliestDate.getFullYear()}">
      <input class="normWid" type="text" maxlength="2" size="2" id="month" name="month" value="${earliestDate.getMonth() + 1}">
      <input class="normWid" type="text" maxlength="2" size="2" id="day" name="day" value="${earliestDate.getDate()}"></br>
      <label>Data Elements to download: </label>
      <select id="loggables" name="loggables" multiple>
        ${getSheets()}
      </select></br></br>
      <label>Sheet to store data: </label>
      <select id="sheets" onchange='
        var val = this.value;
        document.getElementById("newSheet").value="1";
        document.getElementById("sheetID").value=val=="new"?"":val;
        var hiders = document.getElementsByClassName("sheetName");
        var display=val=="new"?"visible":"hidden";
        for (const item of hiders) {
          item.style.visibility = display;
        }'>
        ${getLoggables()}
        <option value="new">
          New Sheets
        </option>
        </select></br>
        <label class="sheetName">Name:</label>
        <input type="text" id="sheetID" name="sheetID" value="${selectSheet.getSheetId()}" class="sheetName"></br></br>
        <input type="hidden" id="newSheet" name="newSheet" value="0">
        <center>
          <input class="normWid" type="button" value="Submit" onclick="google.script.run.withSuccessHandler(function(value){}).submitData(document.getElementById('form'));
            document.getElementById('form').style.display = 'none';
            document.getElementById('done').style.display = 'block';
          ">
        </center>
    </form>
    <p id="done" style="display:none;">Please wait!</p>
  `;

  var app = HtmlService.createHtmlOutput().setTitle("Setup Fitbit Download").setContent(defaultHTML(headHTML, bodyHTML));
  doc.show(app);
}

function authWindow() {
  var doc = SpreadsheetApp.getActiveSpreadsheet();
  var service = getFitbitService();
  var authorizationUrl = service.getAuthorizationUrl();
  var contentHTML =
    '<a href="' +
    authorizationUrl +
    '" target="_blank">Click here to Authorize with Fitbit</a>'
  var app = HtmlService.createHtmlOutput()
    .setTitle("Setup Fitbit Download")
    .setContent(contentHTML);
  doc.show(app);
}

function authCallback(request) {
  Logger.log("authcallback");
  var service = getFitbitService();
  var isAuthorized = service.handleCallback(request);
  var app;
  var contentHTML;
  if (isAuthorized) {
    var displayContentHTML = "Success! Please refresh the page .";
    var displayApp = HtmlService.createHtmlOutput()
      .setTitle("All done!")
      .setContent(displayContentHTML);
    contentHTML = "Success! You can close this tab.";
    app = HtmlService.createHtmlOutput()
      .setTitle("Authorised!")
      .setContent(contentHTML);
    var doc = SpreadsheetApp.getActiveSpreadsheet();
    doc.show(displayApp);
  } else {
    contentHTML =
      "Authorisation was denied.</br>Please check your FitBit credentials and try again!";
    app = HtmlService.createHtmlOutput()
      .setTitle("Oh no!")
      .setContent(contentHTML);
  }
  return app;
}

function syncCustom() {
  var doc = SpreadsheetApp.getActiveSpreadsheet();
  var headHTML = `
    <script>
      function submitForm(form) {
        google.script.run.withSuccessHandler(function(value){})
        document.getElementById("form").style.display === "none";
        document.getElementById("done").style.display = "block";
        .submitData(form);
      }
    </script>
  `;
  var bodyHTML = `
    <form id="form">
      <input type="hidden" id="task" name="task" value="sync">
      <label>Date to sync (year-month-day): </label>
      <input type="text" maxlength="4" size="4" id="year" name="year" value="${new Date().getFullYear()}">
      <input type="text" maxlength="2" size="2" id="month" name="month" value="${new Date().getMonth() + 1}">
      <input type="text" maxlength="2" size="2" id="day" name="day" value="${new Date().getDate()}">
      <input type="button" value="Submit" onclick="google.script.run.withSuccessHandler(function(value){}).submitData(form);
          document.getElementById('form').style.display === 'none';
          document.getElementById('done').style.display = 'block';
      ">
    </form>
    <p id="done" style="display:none;">Done! Close the window!</p>
  `;
  var app = HtmlService.createHtmlOutput().setTitle("Sync Specific Day").setContent(defaultHTML(headHTML, bodyHTML));
  doc.show(app);
}

function problemPrompt(problem = "Undefined problem.",) {
  var doc = SpreadsheetApp.getActiveSpreadsheet();
  var bodyHTML = `
    <p>Something went wrong! Here's the message from the code: </p>
    <code>
        ${problem}
    </code>
    <p>This is just to let you know. You can close this window if you want.</p>
    `;
  var app = HtmlService.createHtmlOutput().setTitle("There was a problem!").setContent(defaultHTML('',bodyHTML));
  doc.show(app);
}

function addTrigger() {
  const availableFunctions = ['sync', 'syncYesterday']
  var bodyHTML  = `
    <form id="form">
      <input type="hidden" id="task" name="task" value="addTrigger">
      <label>Function: </label>
      <select id="function" name="function">
        ${availableFunctions.map(fn => `<option value="${fn}">${fn}</option>`).join('')}
      </select></br>
      <label>At what time? (hh): </label>
      <input type="text" maxlength="2" size="2" id="time" name="time" value="">
      <fieldset>
        <legend>Select a Type</legend>
        <div>
          <input type="radio" id="daily" name="type" value="daily" checked />
          <label for="daily">Daily</label>
        </div>
      </fieldset>
      <input type="button" value="Submit" onclick="google.script.run.withSuccessHandler(function(value){}).submitData(form);
          document.getElementById('form').style.display === 'none';
          document.getElementById('done').style.display = 'block';
      ">
    </form>
    <p id="done" style="display:none;">Done! Close the window!</p>
  `;

  var doc = SpreadsheetApp.getActiveSpreadsheet();
  var app = HtmlService.createHtmlOutput().setTitle("Add a new Trigger").setContent(defaultHTML('',bodyHTML));
  doc.show(app);
  return;
}

// function onOpen is called when the spreadsheet is opened; adds the Fitbit menu
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  var menu = ui.createMenu('Fitbit')
    .addItem('Setup', isConfigured() ? 'setup' : 'firstRun')
    .addItem('Reset', 'clearService')

  // Setup has been passed
  if (isConfigured()) {
    menu
      .addSeparator()
      .addSubMenu(
        ui.createMenu('Sync')
          .addItem('Sync Today', 'sync')
          .addItem('Sync Yesterday', 'syncYesterday')
          .addItem('Sync Custom Date', 'syncCustom')
      )
      .addSubMenu(
        ui.createMenu('Auto-Sync')
          .addItem('Add Trigger', 'addTrigger')
      );
  }
  menu.addToUi();
}
