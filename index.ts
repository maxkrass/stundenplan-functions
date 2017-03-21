'use strict';
/// <reference path="typings/index.d.ts" />

//require('@google-cloud/debug-agent').start({allowExpressions: true});

// Import the Firebase SDK for Google Cloud Functions.
import * as functions from 'firebase-functions';

// Import and initialize the Firebase Admin SDK.
import * as admin from 'firebase-admin';
admin.initializeApp( functions.config().firebase );

import * as request from 'request-promise';
import * as cheerio from 'cheerio';

function unstrikeEverything($: CheerioStatic) {
    $( 'strike' ).each( () => {
        $( this ).replaceWith( $( this ).text() );
    } )
}

function getEvents($: CheerioStatic): SubstitutionEvent[] {
    $( '' );
    return [];
}

class SubstitutionType {
    static Cancelled = "fällt aus";
    static Substitution = "Vertr.";
    static ClassChange = "Unter.-Änd.";
    static LocationChange = "Raum-Änd.";
    static Special = "Sond";
    static Release = "Freisetzung";
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

                const statusDate: string = rowText.substring(rowText.indexOf(" "));

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

                    substitutionPlan.plan = getEvents( $ );

                    unstrikeEverything( $ );

                } else {

                    changes[i] = false;

                    console.log( "No Changes for day " + (i + 1) );

                }

            } )
            .catch( async (err) => {



            } );


        console.log( substitutionPlan );

    }

    res.status( 200 ).end();
} );