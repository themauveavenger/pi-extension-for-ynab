import * as ynab from 'ynab';

const YNAB_PERSONAL_ACCESS_TOKEN = 'YNAB_PERSONAL_ACCESS_TOKEN';

export class YnabClient {
  readonly api: ynab.API;

  constructor(accessToken = process.env[YNAB_PERSONAL_ACCESS_TOKEN]) {
    if (!accessToken) {
      throw new Error(`${YNAB_PERSONAL_ACCESS_TOKEN} environment variable is required`);
    }
    this.api = new ynab.API(accessToken);
  }
}

export function createYnabClientFromEnv(): YnabClient {
  return new YnabClient();
}
