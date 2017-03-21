'use strict';
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
/* <reference path="typings/index.d.ts" />*/
require('@google-cloud/debug-agent').start({ allowExpressions: true });
// Import the Firebase SDK for Google Cloud Functions.
const functions = require("firebase-functions");
// Import and initialize the Firebase Admin SDK.
const admin = require("firebase-admin");
admin.initializeApp(functions.config().firebase);
const request = require("request-promise");
const $ = require("cheerio");
//import * as $ from 'jquery';
function unstrikeEverything(rows) {
    rows.find('strike').each(() => {
        $(this).replaceWith($(this).text());
    });
    return rows;
}
function cleanString(text) {
    return replaceWith(text, " ", "&nbsp;", "\\s+", String.fromCharCode(160));
}
function replaceWith(text, replaceWith, ...find) {
    find.forEach((findString) => {
        text = text.split(findString).join(replaceWith);
    });
    return text;
}
function getEvents() {
    let rows = unstrikeEverything($('table.mon_list').first().find('.odd, .even'));
    let events = [];
    rows.each((rowIndex) => {
        let row = $(this);
        let event = new SubstitutionEvent();
        // This flag is used to continue the outer each statement
        let flag = true;
        row.children().each((cellIndex) => {
            let cell = $(this);
            switch (cellIndex) {
                case 0:
                    let grade = cleanString(cell.text().toUpperCase());
                    if (grade !== "") {
                        event.grade = replaceWith(grade, "", "(", ")");
                    }
                    else {
                        if (rowIndex > 0) {
                            events[events.length - 1].annotation += row.children()[7];
                            // since this row is just annotation, let's continue with the next one
                            flag = false;
                            // And of course also break this each
                            return flag;
                        }
                    }
                    break;
                case 1:
                    event.period = cleanString(cell.text());
                    break;
                case 2:
                    event.subject = cleanString(cell.text().toUpperCase());
                    break;
                case 3:
                    event.type = SubstitutionType.getTypeByString(cleanString(cell.text()));
                    break;
                case 4:
                    event.oldTeacher = cleanString(cell.text());
                    break;
                case 5:
                    if (event.type !== SubstitutionType.Cancelled) {
                        event.sub = cleanString(cell.text());
                    }
                    break;
                case 6:
                    if (event.type !== SubstitutionType.Cancelled) {
                        event.newLocation = cleanString(cell.text());
                    }
                    break;
                case 7:
                    event.annotation = cleanString(cell.text());
                    break;
            }
        });
        // continue if the flag was changed
        if (!flag) {
            return;
        }
        // We're done with this row, add the event to the array
        events.push(event);
    });
    return events;
}
class SubstitutionEvent {
    set grade(value) {
        this._grade = value;
    }
    set period(value) {
        this._period = value;
    }
    set subject(value) {
        this._subject = value;
    }
    set type(value) {
        this._type = value;
    }
    set oldTeacher(value) {
        this._oldTeacher = value;
    }
    set sub(value) {
        this._sub = value;
    }
    set newLocation(value) {
        this._newLocation = value;
    }
    set annotation(value) {
        this._annotation = value;
    }
}
class SubstitutionType {
    static getTypeByString(s) {
        switch (s) {
            case "fällt aus":
                return SubstitutionType.Cancelled;
            case "Vertr.":
                return SubstitutionType.Substitution;
            case "Unter.-Änd.":
                return SubstitutionType.ClassChange;
            case "Raum-Änd.":
                return SubstitutionType.LocationChange;
            case "Sond":
                return SubstitutionType.Special;
            case "Freisetzung":
                return SubstitutionType.Release;
            default:
                return null;
        }
    }
}
SubstitutionType.Cancelled = "fällt aus";
SubstitutionType.Substitution = "Vertr.";
SubstitutionType.ClassChange = "Unter.-Änd.";
SubstitutionType.LocationChange = "Raum-Änd.";
SubstitutionType.Special = "Sond";
SubstitutionType.Release = "Freisetzung";
exports.checkPlan = functions.https.onRequest((req, res) => __awaiter(this, void 0, void 0, function* () {
    const key = req.query.key;
    // Exit if the keys don't match
    if (key !== functions.config().cron.key) {
        console.log('The key provided in the request does not match the key set in the environment. Check that', key, 'matches the cron.key attribute in `firebase env:get`');
        res.status(403).send('Security key does not match. Make sure your "key" URL query parameter matches the ' +
            'cron.key environment variable.');
        return;
    }
    console.log("Key matches");
    const urls = [
        'http://www.mpg-plan.max-planck-gymnasium-duesseldorf.de/Vertretungsplan/Moodle/SII/t1/subst_001.htm',
        'http://www.mpg-plan.max-planck-gymnasium-duesseldorf.de/Vertretungsplan/Moodle/SII/t2/subst_001.htm',
        'http://www.mpg-plan.max-planck-gymnasium-duesseldorf.de/Vertretungsplan/Moodle/SII/t3/subst_001.htm',
    ];
    const changes = [false, false, false];
    for (let i = 0; i < urls.length; i++) {
        const options = {
            uri: urls[i],
            transform: function (body) {
                return $.load(body);
            }
        };
        const substitutionPlan = { statusDate: '', correspondingDate: '', plan: [] };
        yield request(options)
            .then(($) => __awaiter(this, void 0, void 0, function* () {
            let rowText = $('table.mon_head td[align=right]').children().first().text();
            rowText = rowText.substring(rowText.indexOf("Stand: "));
            const statusDate = rowText.substring(rowText.indexOf(" ")).trim();
            console.log("Stand: " + statusDate);
            const updateDateRef = admin.database().ref()
                .child('stundenplan')
                .child('latestSubstitutionPlans')
                .child('updateDates')
                .child('updateDate' + (i + 1));
            const statusSnapshot = yield updateDateRef.once('value');
            if (!statusSnapshot.exists() || statusSnapshot.val() != statusDate) {
                console.log("Die Datenbank sagt: " + statusSnapshot.val());
                changes[i] = true;
                substitutionPlan.statusDate = statusDate;
                const dateText = $('div.mon_title').first().text().trim();
                substitutionPlan.correspondingDate = dateText.substring(0, dateText.indexOf(', Woche '));
                substitutionPlan.plan = getEvents();
                //unstrikeEverything( $ );
            }
            else {
                changes[i] = false;
                console.log("No Changes for day " + (i + 1));
            }
        }))
            .catch(() => __awaiter(this, void 0, void 0, function* () {
        }));
        console.log(substitutionPlan);
    }
    res.status(200).end();
}));
