const { auth } = require('googleapis/build/src/apis/abusiveexperiencereport');
const { sheets } = require('googleapis/build/src/apis/sheets');

util.io = (function () {
    let google_oAuth2Client;

    const init_module = function ($c) {
        util.io.view.init_module($c);
        google_oAuth2Client = null;

        util.io.constants = require('../js/renderer/util/io/constants');
    };

    const sheet_url_to_sheet_id = function (sheetUrl) {
        if (sheetUrl.match(/^[a-zA-Z0-9-_]+$/g) != null) {
            return sheetUrl;
        } else {
            let matches = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
            if (matches !== null && matches.length > 0) {
                return matches[1];
            }
        }
        return null;
    };

    const get_google_sheet_id = function () {
        return util.io.view.get_google_sheet_id()
            .then(result => {
                if (!result.canceled) {
                    let sheet_id = sheet_url_to_sheet_id(result.sheet_url);
                    let student_columns = result.student_columns;
                    let team_columns = result.team_columns;
                    let class_name = result.class_name;
                    if (sheet_id !== null) {
                        return { canceled: false, sheet_id: sheet_id, student_columns: student_columns, team_columns: team_columns, class_name: class_name };
                    } else {
                        return Promise.reject('The URL did not match the expected sheet id pattern');
                    }
                } else {
                    return { canceled: true };
                }
            });
    };

    const get_google_sheet_id_2 = async function(){
        const result = await util.io.view.get_google_sheet_id_2();
        if(!result.canceled){
            const sheet_id = sheet_url_to_sheet_id(result.sheet_url);
            if(sheet_id !== null){
                return {canceled: false, sheet_id: sheet_id};
            }
            else{
                return "The URL did not match the expected sheet id pattern";
            }
        }
        else{
            return {canceled: true};
        }
    };

    const create_google_creds = function () {
        return new Promise((resolve, reject) => {
            return util.io.view.get_google_creds()
                .then(file_path => {
                    return fs.copyFile(file_path, util.io.constants.GOOGLE_CREDENTIALS_PATH)
                        .then(resolve);
                })
                .catch(err => reject(err));
        });
    };

    const get_google_creds = function () {
        return new Promise((resolve, reject) => {
            return fs.access(util.io.constants.GOOGLE_CREDENTIALS_PATH)
                .catch(() => {
                    return create_google_creds();
                })
                .catch(err => reject('Problem creating Google Credentials: ' + err))
                .then(() => {
                    return fs.readFile(util.io.constants.GOOGLE_CREDENTIALS_PATH)
                        .then(credentials => resolve(JSON.parse(credentials)))
                        .catch(err => reject('Problem reading Google Credentials from file '
                            + util.io.constants.GOOGLE_CREDENTIALS_PATH + ' Error: ' + err));
                });
        });
    };

    const create_google_token = function (oAuth) {
        const auth_url = oAuth.generateAuthUrl({
            access_type: 'offline',
            scope: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        return new Promise((resolve, reject) => {
            return util.io.view.get_auth_code(auth_url)
                .then(auth_code => {
                    return oAuth.getToken(auth_code, (err, token) => {
                        if (err) {
                            return reject('Problem retrieving token: ' + err);
                        }

                        return fs.writeFile(util.io.constants.TOKEN_PATH, JSON.stringify(token))
                            .then(resolve)
                            .catch(err => reject('Problem saving token: ' + err));
                    });
                })
                .catch(err => reject('Problem getting authentication code: ' + err));
        });
    };

    const get_google_token = function (oAuth) {
        return new Promise((resolve, reject) => {
            return fs.access(util.io.constants.TOKEN_PATH)
                .catch(() => {
                    return create_google_token(oAuth);
                })
                .catch(err => reject('Problem creating Google Token: ' + err))
                .then(() => {
                    return fs.readFile(util.io.constants.TOKEN_PATH)
                        .then(token_raw => resolve(JSON.parse(token_raw)))
                        .catch(err => reject('Problem reading Google Token: ' + err));
                });
        });
    };

    const get_google_oAuth = function () {
        return get_google_creds()
            .then(credentials => {
                try {
                    const { client_secret, client_id, redirect_uris } = credentials.installed;
                    google_oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
                    return google_oAuth2Client;
                } catch (err) {
                    return Promise.reject('The Google Credentials file stored at '
                        + util.io.constants.GOOGLE_CREDENTIALS_PATH + ' does not have the expected structure.');
                }
            });
    };

    const get_google_sheets = function () {
        return get_google_oAuth()
            .then(oAuthClient => {
                return get_google_token(oAuthClient)
                    .then(token => {
                        oAuthClient.setCredentials(token);
                        return google.sheets({ version: 'v4', auth: oAuthClient });
                    });
            });
    };

    const load_google_sheet_data_old = function (sheet_id, range) {
        return get_google_sheets()
            .then(sheets => sheets.spreadsheets.values.get({
                spreadsheetId: sheet_id,
                range: range
            }))
            .then(res => res.data.values);
    };

    const load_google_sheet_data = async function (sheet_id, range) {
        const sheets = await get_google_sheets();
        const data = await sheets.spreadsheets.values.get({
            spreadsheetId: sheet_id,
            range: range
        });
        return data.data.values;
    };

    //TODO: replicate function with async await
    const load_data_to_JSON_old = function (sheet_id, student_columns, team_columns) {
        const timeslots = generate_timeslots();
        const companies = load_google_sheet_data(sheet_id, ("'Team Responses'!" + team_columns))
            .then(create_team_JSON);
        //.then(add_interview_data)
        const students = load_google_sheet_data(sheet_id, ("'Student Responses'!" + student_columns))
            .then(create_student_JSON);
        return Promise.all([timeslots, companies, students])
            .then(merge_JSON)
            .then(result => JSON.stringify(result, null, "\t"));
        //.then(save_json);
    };

    const load_data_to_JSON = async function (sheet_id, student_columns, team_columns, class_name) {
        const timeslots = generate_timeslots();
        const team_profile_data = await load_google_sheet_data(sheet_id, ("'Team Responses'!" + team_columns));
        const student_data = await load_google_sheet_data(sheet_id, ("'Student Responses'!" + student_columns));
        const team_interview_data = await load_google_sheet_data(sheet_id, "'Team Interview Week Responses'!B:K");
        const companies = await create_team_JSON(team_profile_data, class_name);
        const students = await create_student_JSON(student_data, class_name);
        const updated_companies = await add_interview_data(team_interview_data, companies, class_name);
        const json = await merge_JSON([timeslots, updated_companies, students]);
        const ret = JSON.stringify(json, null, "\t");
        return ret;
    }

    const create_student_JSON = function (data, class_name) {
        const formatted = [];
        const overrides = [];
        for (let i = 1; i < data.length; i++) {
            const row = {};
            let idx = data[0].indexOf("Class");
            if (data[i][idx].localeCompare(class_name) == 0) {
                for (let j = 0; j < data[0].length; j++) {
                    //var student_name = data[j][0];
                    if (isNaN(data[i][j])) {
                        if (data[0][j].includes("Preference")) {
                            if (data[i][j] != null) {
                                if (!("preferences" in row)) {
                                    row["preferences"] = [];
                                }
                                row["preferences"].push(data[i][j]);
                            }
                            else {
                                row["preferences"] = [];
                            }
                        }
                        else if (data[0][j].localeCompare("Override") == 0 && data[i][j] != null) {
                            const dict = {};
                            dict["person"] = data[i][0];
                            dict["team"] = data[i][j];
                            dict["value"] = false;
                            overrides.push(dict)
                        }
                        else {
                            row[data[0][j].toLowerCase()] = data[i][j];
                        }
                    }
                    else {
                        row[data[0][j].toLowerCase()] = parseInt(data[i][j]);
                    }
                }
                formatted.push(row);
            }
        }
        const final = {
            "students": formatted,
            "overrides": overrides
        };
        return final;
    };

    const create_team_JSON = function (data, class_name) {
        const companies = [];
        const companies_added = [];
        for (let i = 1; i < data.length; i++) {
            const team = {};
            let idx = data[0].indexOf("Class");
            if (data[i][idx].includes(class_name)) {
                let company_name = data[i][0];
                for (let j = 0; j < data[0].length; j++) {
                    let team_name = company_name + ": " + data[i][j];
                    if (j == 1) {
                        team[data[0][j].toLowerCase()] = team_name;
                    }
                    else {
                        if (isNaN(data[i][j])) {
                            team[data[0][j].toLowerCase()] = data[i][j];
                        }
                        else {
                            team[data[0][j].toLowerCase()] = parseInt(data[i][j]);
                        }
                    }
                }
                if (!companies_added.includes(company_name)) {
                    companies.push({
                        "name": company_name,
                        "teams": []
                    });
                    companies_added.push(company_name);
                }
                for (let k = 0; k < companies.length; k++) {
                    if (companies[k]["name"].localeCompare(company_name) == 0) {
                        companies[k]["teams"].push(team);
                    }
                }
            }
        }
        const final = { "companies": companies };
        return final;
    };

    const add_interview_data = function (data, companies, class_name) {
        const headers = data[0];
        for (let i = 1; i < data.length; i++) {
            const company_name = data[i][0];
            const team = data[i][0] + ": " + data[i][1];
            var interviewer = "";
            const idx = data[0].indexOf("Class");
            if (data[i][idx].includes(class_name)) {
                //var dict = companies["companies"].find(company => company.name === company_name)["teams"].find(t => t.name === team);
                for (let j = 0; j < headers.length; j++) {
                    if (!(headers[j] == null)) {
                        if (headers[j].localeCompare("Interviewers") == 0) {
                            if (!("interviewers" in companies["companies"].find(company => company.name === company_name)["teams"].find(t => t.name === team))) {
                                companies["companies"].find(company => company.name === company_name)["teams"].find(t => t.name === team)["interviewers"] = [];
                            }
                            interviewer = data[i][j];
                            if ((companies["companies"].find(company => company.name === company_name)["teams"].find(t => t.name === team)["interviewers"].find(
                                i => i.name === interviewer)) == null) {
                                companies["companies"].find(company => company.name === company_name)["teams"].find(t => t.name === team)["interviewers"].push({ "name": interviewer });
                            }
                        }
                        else if (data[0][j].includes("Time")) {
                            let timeslots = convert_timeblock(data[i][j]);
                            //companies["companies"][company][team]["timeslots"] = timeslots;
                            if (!("timeslots" in companies["companies"].find(company => company.name === company_name)["teams"].find(t => t.name === team)["interviewers"].find(
                                i => i.name === interviewer))) {
                                companies["companies"].find(company => company.name === company_name)["teams"].find(t => t.name === team)["interviewers"].find(
                                    i => i.name === interviewer)["timeslots"] = timeslots;
                            }
                            else {
                                companies["companies"].find(company => company.name === company_name)["teams"].find(t => t.name === team)["interviewers"].find(
                                    i => i.name === interviewer)["timeslots"].concat(timeslots);
                            }
                        }
                        else if (data[0][j].includes("Preference")) {
                            if (!("preferences" in companies["companies"].find(company => company.name === company_name)["teams"].find(t => t.name === team))) {
                                //companies["companies"][company][team]["preferences"] = [];
                                companies["companies"].find(company => company.name === company_name)["teams"].find(t => t.name === team)["preferences"] = [];
                            }
                            if (!(data[i][j] == "")) {
                                //companies["companies"][company][team]["preferences"].push(data[i][j]);
                                companies["companies"].find(company => company.name === company_name)["teams"].find(t => t.name === team)["preferences"].push(data[i][j]);
                            }
                        }
                    }
                }
            }
        }
        return companies;
    };

    const convert_timeblock = function (timeblock) {
        const lst = timeblock.split(": ");
        const day = lst[0].split(", ")[0];
        const block = lst[1];
        const morning = ["01", "02", "03", "04", "05", "06"];
        const afternoon = ["07", "08", "09", "10", "11", "12"];
        if (block.includes('am')) {
            return merge_timeslots(day, morning);
        }
        else {
            return merge_timeslots(day, afternoon);
        }
    };

    //day = "Monday", slots = ["01", "02"...]
    const merge_timeslots = function (day, slots) {
        return slots.map(slot => `${day}_${slot}`);
    };

    const merge_JSON = function (data) {
        const timeslots = data[0];
        const companies = data[1];
        const students = data[2];
        const final = {
            ...timeslots,
            ...companies,
            ...students
        };
        return final;
    };

    const generate_timeslots = function () {
        const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
        const times = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
        const timeslots = [];
        for (let i = 0; i < days.length; i++) {
            day = {};
            day["day"] = days[i];
            day["times"] = times;
            timeslots.push(day);
        }
        //return timeslots;
        const final = { "timeslots": timeslots };
        return final;
    };

    revert_timeslot = function (timeslot){
        const times = ["9:00-9:30", "9:40-10:10", "10:20-10:50", "11:00-11:30", "11:40-12:10", "12:20-12:50", "1:00-1:30", "1:40-2:10", "2:20-2:50",
                      "3:00-3:30", "3:40-4:10", "4:20-4:50"];
        const blocks = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
        const day = timeslot.split("_")[0];
        const time = times[blocks.indexOf(timeslot.split("_")[1])];
        const obj = {};
        obj["day"] = day;
        obj["time"] = time;
        return obj;
    };

    const save_to_file = function (filePath, data_fn) {
        return fs.writeFile(filePath, data_fn())
            .then(() => { return { state: 'success' } });
    };

    const save_file = function (filePath, data) {
        return fs.writeFile(filePath, data)
            .then(() => { return { state: 'success' } });
    };

    const save_to_csv = function (data_array_fn) {
        return dialog.showSaveDialog({
            filters: [
                { name: 'CSV', extensions: ['csv'] }
            ]
        }).then(result => {
            if (!result.canceled) {
                return save_to_file(result.filePath, () => convertArrayToCSV(data_array_fn()));
            } else {
                return { state: 'canceled' };
            }
        });
    };

    const save_to_json = function (data_fn) {
        return dialog.showSaveDialog({
            filters: [
                { name: 'JSON', extensions: ['json'] }
            ]
        }).then(result => {
            if (!result.canceled) {
                return save_to_file(result.filePath, () => JSON.stringify(data_fn(), null, '\t'));
            } else {
                return { state: 'canceled' };
            }
        });
    };

    const save_json = function (data) {
        return dialog.showSaveDialog({
            filters: [
                { name: 'JSON', extensions: ['json'] }
            ]
        }).then(result => {
            if (!result.canceled) {
                return save_file(result.filePath, data);
            } else {
                return { state: 'canceled' };
            }
        });
    };

    // const save_to_sheet = function (sheet_title, data_array_fn) {
    //     const resource_create = {
    //         properties: {
    //             title: sheet_title
    //         }
    //     };

    //     return get_google_sheets()
    //         .then(sheets => {
    //             return sheets.spreadsheets.create({
    //                 resource: resource_create,
    //                 fields: 'spreadsheetId'
    //             })
    //                 .then(new_spreadsheet => {
    //                     let data_array = data_array_fn();
    //                     let num_cols = data_array[0].length;
    //                     let range = 'A:' + String.fromCharCode('A'.charCodeAt(0) + (num_cols - 1));

    //                     return sheets.spreadsheets.values.update({
    //                         spreadsheetId: new_spreadsheet.data.spreadsheetId,
    //                         range: range,
    //                         valueInputOption: 'RAW',
    //                         resource: {
    //                             values: data_array
    //                         }
    //                     })
    //                         .then(result => Promise.resolve(new_spreadsheet.data.spreadsheetId))
    //                         .catch(err => Promise.reject('Error saving to spreadsheet ' + new_spreadsheet.data.spreadsheetId + ": " + err));
    //                 })
    //                 .catch(err => Promise.reject('Error creating new spreadsheet: ' + err));
    //         });
    // };

    const save_to_sheet = async function (sheet_title, data_array_fn) {
        const resource_create = {
            properties: {
                title: sheet_title
            }
        };
        let new_spreadsheet; 
        const sheets = await get_google_sheets();
        try {
            new_spreadsheet = await sheets.spreadsheets.create({
                resource: resource_create,
                fields: 'spreadsheetId'
            });
        }
        catch (err) {
            throw 'Error creating new spreadsheet: ' + err;
        }
        const data_array = data_array_fn();
        console.log(data_array);
        const num_cols = data_array[0].length;
        const range = 'A:' + String.fromCharCode('A'.charCodeAt(0) + (num_cols - 1));
        try {
            await sheets.spreadsheets.values.update({
                spreadsheetId: new_spreadsheet.data.spreadsheetId,
                range: range,
                valueInputOption: 'RAW',
                resource: {
                    values: data_array
                }
            });
        }
        catch (err) {
            const id = new_spreadsheet.data.spreadsheetId;
            throw `Error saving to spreadsheet ${id}: ${err}`;
        }
        console.log(new_spreadsheet.data.spreadsheetId);
        return new_spreadsheet.data.spreadsheetId;    
    };

    const get_final_schedule_data = async function(sheet_id){
        const data = await util.io.load_google_sheet_data(sheet_id, "'Sheet1'!A:I");
        const days = {
            "Monday": {},
            "Tuesday": {},
            "Wednesday": {},
            "Thursday": {},
            "Friday": {}
        };
        const headers = data[0];
        const teams_added = [];
        for(let i=1; i<data.length; i++){
            const student = data[i][headers.indexOf("Student")];
            const company = data[i][headers.indexOf("Company")];
            const team = data[i][headers.indexOf("Team")].split(": ")[1];
            const interviewer = data[i][headers.indexOf("Interviewer")];
            const timeslot = revert_timeslot(data[i][headers.indexOf("Timeslot")]);
            const day = timeslot["day"];
            const time = timeslot["time"];
            //const student_obj = {};
            //student_obj[time] = student;
            //student_obj["time"] = time;
            const team_obj = {};
            team_obj["company"] = company;
            team_obj["interviewer"] = interviewer;
            team_obj["link"] = "TBD";
            // team_obj["interviewees"]={};
            // team_obj["interviewees"][time]=student;
            if(teams_added.includes(team+day)){
                days[day][team]["interviewees"][time]=student;
            }
            else{
                team_obj["interviewees"]={};
                team_obj["interviewees"][time]=student;
                days[day][team] = team_obj;
                teams_added.push(team+day);
            }
        }
        return days;
    };

    // const get_day_array = function(data, day){
    //     const day = [];
    //     for(var team in data[day]){
    //         const team_obj = data[day][team];
    //         const column = [];
    //         column.push(team_obj["company"], team, team_obj["interviewer"], team_obj["link"], "Student Name");
    //         for(var name in team_obj["interviewees"]){
    //             column.push(name, "Break and Feedback");
    //         }
    //         day.push(column);
    //     }
    //     alert("day done");
    //     return day;
    // };

    const get_final_array = function(data, day){
        const final = [["Company", "Team", "Interviewer", "Zoom Link", "repl.it Link", "", "Time (PDT)", "9:00-9:30", "9:30-9:40", "9:40-10:10", "10:10-10:20", "10:20-10:50",
        "10:50-11:00", "11:00-11:30", "11:30-11:40", "11:40-12:10", "12:10-12:20", "12:20-12:50", "12:50-1:00", "1:00-1:30", "1:30-1:40", "1:40-2:10", "2:10-2:20",
        "2:20-2:50", "2:50-3:00", "3:00-3:30", "3:30-3:40","3:40-4:10", "4:10-4:20", "4:20-4:50"]];
        const times = ["9:00-9:30", "9:40-10:10", "10:20-10:50", "11:00-11:30", "11:40-12:10", "12:20-12:50", "1:00-1:30", "1:40-2:10", "2:20-2:50",
        "3:00-3:30", "3:40-4:10", "4:20-4:50"];
        for(var team in data[day]){
            const column = [];
            if(data[day].hasOwnProperty(team)){
                const team_obj= data[day][team];
                column.push(team_obj["company"], team, team_obj["interviewer"], team_obj["link"],"", "", "Student Name");
                for(const time of times){
                    if(time in team_obj["interviewees"]){
                        column.push(team_obj["interviewees"][time], "Break and Feedback");
                    }
                    else{
                        column.push("", "Break and Feedback");
                    }
                }
            }
            final.push(column);
        }        
        return final;
    };

    const save_final_to_sheet = async function (sheet_title, final_data) {
        const resource_create = {
            properties: {
                title: sheet_title,
            }
        };
        let new_spreadsheet; 
        const sheets = await get_google_sheets();
        try {
            new_spreadsheet = await sheets.spreadsheets.create({
                resource: resource_create,
                fields: 'spreadsheetId',
            });
        }
        catch (err) {
            throw 'Error creating new spreadsheet: ' + err;
        }
        const num_cols = Object.keys(final_data).length;
        const range = 'A:' + String.fromCharCode('A'.charCodeAt(0) + (num_cols+2));
        // for(const [day, teams] of Object.entries(final_data)){
        // }
        //const final_array = get_final_array(final_data);
       // console.log(final_array);
        console.log(await sheets.spreadsheets.get({
            spreadsheetId: new_spreadsheet.data.spreadsheetId
        }));
        try {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: new_spreadsheet.data.spreadsheetId,
                requestBody: {
                    requests: [
                        {
                            updateSheetProperties: {
                                fields: "title",
                                properties: {
                                    //default sheetID is 0 when new spreadsheet is created
                                    sheetId: 0,
                                    title: "Monday"
                                }
                            }

                        },
                        {
                            addSheet: {
                                properties:{
                                    title: "Tuesday",
                                }
                            }
                        }, 
                        {
                            addSheet: {
                                properties:{
                                    title: "Wednesday",
                                }
                            }
                        },
                        {
                            addSheet: {
                                properties:{
                                    title: "Thursday",
                                }
                            }
                        },
                        {
                            addSheet: {
                                properties:{
                                    title: "Friday",
                                }
                            }
                        }
                    ]
               }
            });
            const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
            //const monday_data = get_final_array(final_data, "Monday");
            for(var day of days){
                const day_array = get_final_array(final_data, day);
                await sheets.spreadsheets.values.update({
                    spreadsheetId: new_spreadsheet.data.spreadsheetId,
                    range: day +'!A:' + String.fromCharCode('A'.charCodeAt(0) + (day_array.length)),
                    valueInputOption: 'RAW',
                    resource: {
                        values: day_array,
                        majorDimension: "COLUMNS"
                    }
                });
            }
            // await sheets.spreadsheets.batchUpdate({
            //     spreadsheetId: new_spreadsheet.data.spreadsheetId,
            //     requestBody: {
            //         requests: [
            //             {
            //                 repeatCell: {
            //                     range: {
            //                         sheetId: 0,
            //                         startRowIndex: 0,
            //                         endRowIndex: 1
            //                     },
            //                     cell: {
            //                         userEnteredFormat: {
            //                             textFormat: {
            //                                 bold: true
            //                             }
            //                         }
            //                     },
            //                     fields: "userEnteredFormat.textFormat.bold"
            //                 }
            //             }
            //         ]
            //     }
            // });
        }
        catch (err) {
            const id = new_spreadsheet.data.spreadsheetId;
            throw `Error saving to spreadsheet ${id}: ${err}`;
        }
        return new_spreadsheet.data.spreadsheetId;    
    };

    return {
        init_module: init_module,
        get_google_sheet_id: get_google_sheet_id,
        get_google_sheet_id_2: get_google_sheet_id_2,
        load_google_sheet_data: load_google_sheet_data,
        load_data_to_JSON: load_data_to_JSON,
        get_final_schedule_data: get_final_schedule_data,
        save_to_csv: save_to_csv,
        save_to_sheet: save_to_sheet,
        save_final_to_sheet: save_final_to_sheet,
        save_to_json: save_to_json
    };
}());