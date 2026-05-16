# pi-extension-for-ynab

Pi extension that registers tools for working with a personal YNAB account.

## Configuration

Set a YNAB personal access token in your environment:

```bash
export YNAB_PERSONAL_ACCESS_TOKEN=...
```

## Pi TUI usage

Local development:

```bash
cd /home/josh/Code/node/pi-extension-for-ynab
npm install
npm run build
pi -e /home/josh/Code/node/pi-extension-for-ynab
```

GitHub install after a release tag exists:

```bash
pi install git:github.com/<user>/pi-extension-for-ynab@v0.1.0
```

## Embedding in Barnaby

```ts
import { createYnabExtension } from 'pi-extension-for-ynab';

const resourceLoader = new DefaultResourceLoader({
  extensionFactories: [
    createYnabExtension()
  ]
});
```

The default factory reads `YNAB_PERSONAL_ACCESS_TOKEN`. Tests or custom integrations may inject an existing `ynab.API` instance:

```ts
createYnabExtension({ ynabAPI });
```
