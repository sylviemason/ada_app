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
                    if (sheet_id !== null) {
                        return {canceled: false, sheet_id: sheet_id};
                    } else {
                        return Promise.reject('The URL did not match the expected sheet id pattern');
                    }
                } else {
                    return {canceled: true};
                }
            });
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
                    const {client_secret, client_id, redirect_uris} = credentials.installed;
                    google_oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
                    return google_oAuth2Client;
                } catch (err) {
                    return Promise.reject('The Google Credentials file stored at '
                        + util.io.constants.GOOGLE_CREDENTIALS_PATH + ' does not have the expected structure.');
                }
            });
    };

    const get_google_sheets = function() {
        return get_google_oAuth()
            .then(oAuthClient => {
                return get_google_token(oAuthClient)
                    .then(token => {
                        oAuthClient.setCredentials(token);
                        return google.sheets({version: 'v4', auth: oAuthClient});
                    });
            });
    };

    const load_google_sheet_data = function (sheet_id, range) {
        return get_google_sheets()
            .then(sheets => sheets.spreadsheets.values.get({
                spreadsheetId: sheet_id,
                range: range
            }))
            .then(res => res.data.values);
    };

    const load_data_to_JSON = function(sheet_id){
        const companies = load_google_sheet_data(sheet_id, "'Team data'!B:N")
            .then(create_team_JSON);
        const students = load_google_sheet_data(sheet_id, "'Student data'!B:K")
            .then(create_student_JSON);
        Promise.all([companies, students])
        .then(merge_JSON)
        .then(result => JSON.stringify(result, null, "\t"))
        .then(save_json);
    };

    const create_student_JSON = function (data){
        const formatted = [];
        for(let i=1; i<data.length; i++){
            const row = {};
            for(let j=0; j<data[0].length; j++){
                if(isNaN(data[i][j])){
                    row[data[0][j]] = data[i][j];
                }
                else{
                    row[data[0][j]] = parseInt(data[i][j]);
                }
                
            }
            formatted.push(row);
        } 
        const final = {"students" : formatted};
        return final;
    }
    
    const create_team_JSON = function (data){
        const companies = [];
        const companies_added = [];
        for(let i=1; i<data.length; i++){
            const team = {};
            let company_name = data[i][0];
            for(let j=0; j<data[0].length; j++){
                let team_name = company_name+": "+data[i][j];
                if(j==1){
                    team[data[0][j]]=team_name;
                }
                else{
                    if(isNaN(data[i][j])){
                        team[data[0][j]] = data[i][j];
                    }
                    else{
                        team[data[0][j]] = parseInt(data[i][j]);
                    }
                }
            }
            if(! companies_added.includes(company_name)){
                companies.push({
                    "name" : company_name,
                    "teams" : []
                });
                companies_added.push(company_name);
            }
            for(let k=0; k<companies.length; k++){
                if(companies[k]["name"].localeCompare(company_name)==0){
                    companies[k]["teams"].push(team);
                }
            }
        }
        const final = {"companies": companies};
        return final;
    }

    const merge_JSON = function(companies, students){
        const merged = companies.concat(students);
        return merged;
    }

    const save_to_file = function(filePath, data_fn) {
        return fs.writeFile(filePath, data_fn())
            .then(() => { return {state: 'success'} });
    };

    const save_file = function(filePath, data) {
        return fs.writeFile(filePath, data)
            .then(() => { return {state: 'success'} });
    };

    const save_to_csv = function(data_array_fn) {
        return dialog.showSaveDialog({
            filters: [
                { name: 'CSV', extensions: ['csv'] }
            ]
        }).then(result => {
            if (!result.canceled) {
                return save_to_file(result.filePath, () => convertArrayToCSV(data_array_fn()));
            } else {
                return {state: 'canceled'};
            }
        });
    };

    const save_to_json = function(data_fn) {
        return dialog.showSaveDialog({
            filters: [
                { name: 'JSON', extensions: ['json'] }
            ]
        }).then(result => {
            if (!result.canceled) {
                return save_to_file(result.filePath, () => JSON.stringify(data_fn(), null, '\t'));
            } else {
                return {state: 'canceled'};
            }
        });
    };

    const save_json = function(data) {
        return dialog.showSaveDialog({
            filters: [
                { name: 'JSON', extensions: ['json'] }
            ]
        }).then(result => {
            if (!result.canceled) {
                return save_file(result.filePath, data);
            } else {
                return {state: 'canceled'};
            }
        });
    };

    const save_to_sheet = function (sheet_title, data_array_fn) {
        const resource_create = {
            properties: {
                title: sheet_title
            }
        };

        return get_google_sheets()
            .then(sheets => {
                return sheets.spreadsheets.create({
                    resource: resource_create,
                    fields: 'spreadsheetId'
                })
                    .then(new_spreadsheet => {
                        let data_array = data_array_fn();
                        let num_cols = data_array[0].length;
                        let range = 'A:' + String.fromCharCode('A'.charCodeAt(0) + (num_cols - 1));

                        return sheets.spreadsheets.values.update({
                            spreadsheetId: new_spreadsheet.data.spreadsheetId,
                            range: range,
                            valueInputOption: 'RAW',
                            resource: {
                                values: data_array
                            }
                        })
                            .then(result => Promise.resolve(new_spreadsheet.data.spreadsheetId))
                            .catch(err => Promise.reject('Error saving to spreadsheet ' + new_spreadsheet.data.spreadsheetId + ": " + err));
                    })
                    .catch(err => Promise.reject('Error creating new spreadsheet: ' + err));
            });
    };

    return {
        init_module: init_module,
        get_google_sheet_id: get_google_sheet_id,
        load_google_sheet_data: load_google_sheet_data,
        load_data_to_JSON: load_data_to_JSON,
        save_to_csv: save_to_csv,
        save_to_sheet: save_to_sheet,
        save_to_json: save_to_json
    };
}());