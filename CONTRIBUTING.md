# Contributing

Bug reports and improvement PRs are welcome.

## Development

Run `npm ci` with Node.js 22 or later. Load `extension/` on the Chrome extensions page to use it without a build step. After changing the code, click reload on the extensions page.

```sh
npm test
npx playwright install chromium
npm run test:browser
npm run package
```

On Linux, `npx playwright install --with-deps chromium` prepares the browser's runtime dependencies.

## Change guidelines

- Do not commit personal screenshots or logs containing personal information.
- For any runtime data transfer or new permission, explain the need and impact in an issue first.
- In a PR, describe how to reproduce a bug fix, or the user flow and what you verified for a feature change.
- When changing full-page capture, check that the scroll position and original styles are restored and that no fixed elements go missing.

Contributed code is released under the project's MIT license.
