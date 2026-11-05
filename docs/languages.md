# Screen Mark language support

English is the default, and the order of choices is English, 한국어, 日本語, Español. The capture menu, the editor and existing selection tabs offer the same language choice.

- The choice is kept in the extension's browser storage. Text in open extension tabs updates without reloading the screen.
- Images, user file names, text typed by the user, marks, undo history, the selected tool and zoom do not change. Tool descriptions, status and error messages, titles and accessibility labels are translated.
- The region selection guide shown on the actual page keeps the language set when the selection started. Changing the language and starting again uses the new language.
- If the setting cannot be saved, the previous language stays and a retry message appears. Unknown stored or requested values are treated as English.
- The name and description on the extensions page follow Chrome's language. The language chosen in the app applies to the capture and editing screens.

## Managing translations

`extension/i18n.js` manages the language order, the English default, saving the choice and refreshing the screen. `extension/translations.js` uses the Korean source text as stable keys and holds the English, Japanese and Spanish translations. Pure model and storage modules keep their error format and `Error.name`, and messages are translated when displayed. Unknown browser errors keep their diagnostic text.

Dynamic text uses variables such as `{count}` and `{error}`. When adding a message, the variables in all three translations must match. Translated text goes only into `textContent` or the relevant attribute and is never parsed as HTML. Do not add user file names or mark text to the dictionary when editing screen text.

## Testing

`npm test` checks the language order, the default, invalid settings, translation variables, save failures, passing through original errors and Chrome metadata. `npm run test:languages` runs real capture, editing, saving and copying in all four languages in a separate Chrome profile. It compares that the same document and revision are kept across language changes, and also covers restarting a region selection in a new language.

The general browser, region, paste and save stability regression tests select Korean with `tests/support/language.mjs` to check existing behavior. The language-specific test starts from the English default in a new profile. The README screenshots are taken in English with `npm run docs:images`.
