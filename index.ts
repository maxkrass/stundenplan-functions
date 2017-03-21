'use strict';
/* <reference path="typings/index.d.ts" />*/

require( '@google-cloud/debug-agent' ).start( {allowExpressions: true} );

// Import the Firebase SDK for Google Cloud Functions.
import * as functions from 'firebase-functions';

// Import and initialize the Firebase Admin SDK.
import * as admin from 'firebase-admin';
admin.initializeApp( functions.config().firebase );

import * as request from 'request-promise';
import * as cheerio from 'cheerio';
//import * as $ from 'jquery';

function unstrikeEverything(rows: Cheerio): Cheerio {
    console.log("Before");
    console.log(rows.html());
    rows.find( 'strike' ).each( () => {
        $( this ).replaceWith( $( this ).text() );
    } );
    console.log("After");
    console.log(rows.html());
    return rows;
}

function cleanString(text: string): string {
    return replaceWith( text, " ", "&nbsp;", "\\s+", String.fromCharCode( 160 ) );
}

function replaceWith(text: string, replaceWith: string, ...find: string[]): string {
    find.forEach( (findString: string) => {
        text = text.split( findString ).join( replaceWith );
    } );
    return text;
}

function getEvents($: CheerioStatic): SubstitutionEvent[] {
    let rows: Cheerio = unstrikeEverything( $( 'table.mon_list' ).first().find( '.odd, .even' ) );

    let events: SubstitutionEvent[] = [];

    rows.each( (rowIndex: number) => {
        let row: Cheerio = $( this );

        let event: SubstitutionEvent = new SubstitutionEvent();

        // This flag is used to continue the outer each statement
        let flag: boolean = true;

        row.children().each( (cellIndex: number) => {
            let cell: Cheerio = $( this );

            switch (cellIndex) {

                case 0:
                    let grade: string = cleanString( cell.text().toUpperCase() );
                    if ( grade !== "" ) {
                        event.grade = replaceWith( grade, "", "(", ")" );
                    } else { // this row has no Grade so we can
                        if ( rowIndex > 0 ) { //assume that it is meant as an annotation to the last row
                            events[events.length - 1].annotation += row.children()[7];
                            // since this row is just annotation, let's continue with the next one
                            flag = false;
                            // And of course also break this each
                            return flag;
                        }
                    }
                    break;
                case 1:
                    event.period = cleanString( cell.text() );
                    break;
                case 2:
                    event.subject = cleanString( cell.text().toUpperCase() );
                    break;
                case 3:
                    event.type = SubstitutionType.getTypeByString( cleanString( cell.text() ) );
                    break;
                case 4:
                    event.oldTeacher = cleanString( cell.text() );
                    break;
                case 5:
                    if ( event.type !== SubstitutionType.Cancelled ) {
                        event.sub = cleanString( cell.text() );
                    }
                    break;
                case 6:
                    if ( event.type !== SubstitutionType.Cancelled ) {
                        event.newLocation = cleanString( cell.text() );
                    }
                    break;
                case 7:
                    event.annotation = cleanString( cell.text() );
                    break;

            }

        } );

        // continue if the flag was changed
        if ( !flag ) {
            return
        }

        // We're done with this row, add the event to the array
        events.push(event);

    } );

    return events;
}

class SubstitutionEvent {
    private _grade: string;
    private _period: string;
    private _subject: string;
    private _type: SubstitutionType;
    private _oldTeacher: string;
    private _sub: string;
    private _newLocation: string;
    private _annotation: string;


    set grade(value: string) {
        this._grade = value;
    }

    set period(value: string) {
        this._period = value;
    }

    set subject(value: string) {
        this._subject = value;
    }

    set type(value: SubstitutionType) {
        this._type = value;
    }

    set oldTeacher(value: string) {
        this._oldTeacher = value;
    }

    set sub(value: string) {
        this._sub = value;
    }

    set newLocation(value: string) {
        this._newLocation = value;
    }

    set annotation(value: string) {
        this._annotation = value;
    }
}

class SubstitutionType {

    static Cancelled = "fällt aus";
    static Substitution = "Vertr.";
    static ClassChange = "Unter.-Änd.";
    static LocationChange = "Raum-Änd.";
    static Special = "Sond";
    static Release = "Freisetzung";

    static getTypeByString(s: string): SubstitutionType {
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

export let checkPlan = functions.https.onRequest( async (req, res) => {
    const key: string = req.query.key;

    // Exit if the keys don't match
    if ( key !== functions.config().cron.key ) {
        console.log( 'The key provided in the request does not match the key set in the environment. Check that', key,
                     'matches the cron.key attribute in `firebase env:get`' );
        res.status( 403 ).send( 'Security key does not match. Make sure your "key" URL query parameter matches the ' +
                                'cron.key environment variable.' );
        return;
    }

    console.log( "Key matches" );

    const urls: string[] = [
        'http://www.mpg-plan.max-planck-gymnasium-duesseldorf.de/Vertretungsplan/Moodle/SII/t1/subst_001.htm',
        'http://www.mpg-plan.max-planck-gymnasium-duesseldorf.de/Vertretungsplan/Moodle/SII/t2/subst_001.htm',
        'http://www.mpg-plan.max-planck-gymnasium-duesseldorf.de/Vertretungsplan/Moodle/SII/t3/subst_001.htm',
    ];

    const changes: boolean[] = [false, false, false];

    for (let i: number = 0; i < urls.length; i++) {

        const options = {
            uri: urls[i],
            transform: function (body) {
                return cheerio.load( body );
            }
        };

        const substitutionPlan = {statusDate: '', correspondingDate: '', plan: []};

        await request( options )
            .then( async $ => {

                let rowText: string = $( 'table.mon_head td[align=right]' ).children().first().text();

                rowText = rowText.substring( rowText.indexOf( "Stand: " ) );

                const statusDate: string = rowText.substring( rowText.indexOf( " " ) ).trim();

                console.log( "Stand: " + statusDate );

                const updateDateRef: admin.database.Reference = admin.database().ref()
                    .child( 'stundenplan' )
                    .child( 'latestSubstitutionPlans' )
                    .child( 'updateDates' )
                    .child( 'updateDate' + (i + 1) );

                const statusSnapshot: admin.database.DataSnapshot = await updateDateRef.once( 'value' );

                if ( !statusSnapshot.exists() || statusSnapshot.val() != statusDate ) {

                    console.log( "Die Datenbank sagt: " + statusSnapshot.val() );

                    changes[i] = true;

                    substitutionPlan.statusDate = statusDate;

                    const dateText: string = $( 'div.mon_title' ).first().text().trim();

                    substitutionPlan.correspondingDate = dateText.substring( 0, dateText.indexOf( ', Woche ' ) );

                    substitutionPlan.plan = getEvents($);

                    //unstrikeEverything( $ );

                } else {

                    changes[i] = false;

                    console.log( "No Changes for day " + (i + 1) );

                }

            } )
            .catch( async () => {
            } );


        console.log( substitutionPlan );

    }

    res.status( 200 ).end();
} );