# J's ChatGPT-CRT-Terminal-Shell

Oracle CRT Terminal Shell is a Tampermonkey userscript that transforms ChatGPT interface into an amber-phosphor CRT terminal. Preserves the real ChatGPT composer and controls underneath the shell while adding curved WebGL rendering, synchronized terminal input, popup tools, visible Activity capture, code-copy controls, and a persistent standby mode.

## Preview

![Oracle CRT terminal main screen](https://github.com/user-attachments/assets/d2e680bc-636d-471c-bf13-be55bdb1fed6)

![Oracle CRT terminal popup interface](https://github.com/user-attachments/assets/2745f405-6a94-4ba9-8655-108dbca44e30)

![Oracle CRT terminal detail view](https://github.com/user-attachments/assets/d92c9400-4e33-4a5a-947b-ce81f3fcd7eb)

## Features

### CRT rendering

- Curved WebGL screen projection.
- Amber phosphor palette with bloom, text glow, edge shading, and a soft vignette.
- Animated top-to-bottom refresh field with a fading scan trail.
- Subtle corner darkening and CRT-style popup curvature.
- Terminal-formatted user and assistant messages.

### Terminal input

- Click the main screen for terminal input.
- The cursor is placed at the end of the existing draft when the terminal gains focus.
- CRT and native ChatGPT drafts are synchronized in both directions.
- Empty drafts are synchronized correctly instead of being treated as missing data.
- Draft text is flushed back to the native composer before the shell is disabled.
- Native drafts are restored into the CRT input when the shell is enabled.

### Popup tools

- **SIDEBAR** mirrors available chat history and can request older conversations as you scroll.
- **THINKING** reads the visible ChatGPT Activity/Reasoning panel and displays its exposed modules.
- **CHATBOX** temporarily docks the real ChatGPT composer inside a curved CRT popup.
- **MODEL SELECT** dynamically reads the current ChatGPT model menu, including nested model and intelligence options.
- **DICTATE** mirrors native dictation state with an 11 x 11 audio-reactive matrix.
- All popup windows use the same amber palette, glow treatment, and curved-screen styling as the main display.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser.
2. Use the js. file.
3. reload.

The userscript matches both:

```text
https://chatgpt.com/*
https://chat.openai.com/*
```

Tampermonkey is recommended. Other userscript managers may work, but are not the primary target.

## Controls

| Control | Action |
| --- | --- |
| Click main screen | Focus input and move the cursor to the end of the draft |
| `SIDEBAR` | Open mirrored chat history |
| `THINKING` | Open visible Activity/Reasoning details |
| `SCRIPT OFF` / `SCRIPT ON` | Toggle the CRT shell without disabling the userscript |
| `SEND` | Send through the native ChatGPT composer |
| `ADD FILE` | Open the native attachment control |
| `DICTATE` | Start or adopt native dictation |
| `MODEL SELECT` | Read and operate the native model picker |
| `CHATBOX` | Dock or restore the native composer |
| `COPY CODE` | Copy the associated code block |
| `Alt+Shift+O` | Toggle the CRT shell from the keyboard |

The shell's on/off state is stored in `localStorage`, so standby mode persists across reloads.

## Dictate behavior

When Dictate is started from the shell:

1. The current CRT draft is synchronized to the native composer.
2. The script sends the native `Ctrl+Shift+D` command once.
3. The matrix starts only after the native Dictate state is detected.
4. `FINISH` sends `Ctrl+Shift+D`, waits for the transcript to stabilize, and safely merges it with the existing draft.
5. `CANCEL` sends `Escape`, stops the waveform, restores the pre-recording draft, and closes the popup.

If native Dictate was already active before the shell was enabled, the script adopts that session instead of sending another start command. The popup title reports `STARTING`, `RECORDING`, `PAUSED`, `FINISHING`, or `ERROR` as appropriate.

> **Microphone note:** browsers do not expose ChatGPT's existing microphone stream to a userscript. The matrix therefore uses a separate local `getUserMedia()` stream for amplitude visualization, but that stream is started only after native Dictate has been confirmed and is stopped if native state is lost.

## Thinking and progress display

The Thinking popup reads Activity/Reasoning content that ChatGPT has already rendered in the page. During answer generation, the terminal adds a package-manager-style animated progress signal based on the visible activity modules.

This userscript cannot access hidden chain-of-thought or reasoning that ChatGPT does not expose in the interface.

## Model selection

Model names are not hard-coded. The script opens the live ChatGPT picker, reads currently available options, follows nested menu paths, and generates matching CRT buttons. Available entries therefore depend on your account, plan, workspace, and ChatGPT's current interface.

If no options are detected:

1. Open `CHATBOX` once so the native composer is available.
2. Close it and press `MODEL SELECT` again.
3. Reload ChatGPT if the native picker structure has recently changed.

## Customization

The main visual settings are near the top of `Oracle_CRT.js` or inside the WebGL fragment shader:

| Setting | Purpose |
| --- | --- |
| `COLORS` | Amber, answer, selection, and accent colors |
| `MAX_MESSAGES` | Maximum number of recent messages rendered by the shell |
| `DICTATE_MATRIX_SIZE` | Dictate visualization grid size |
| `u_curve` | Main screen curvature strength |
| `edgeVignette` / `edgeMask` | Perimeter dark-field range and strength |
| `scanY` / `refreshField` | Refresh sweep timing, width, and trail |

After editing the userscript, save it in Tampermonkey and reload the ChatGPT tab.

## Compatibility and limitations

- A modern browser with WebGL, canvas, `MutationObserver`, and current CSS support is required.
- Chromium-based browsers such as Chrome and Edge are recommended.
- Microphone permission is required only for the Dictate matrix visualization.
- ChatGPT is a continuously changing web application. Sidebar, Activity, model-picker, composer, or Dictate DOM changes may temporarily break the corresponding integration.
- Model availability and reasoning UI differ by account and subscription.
- Synthetic keyboard shortcuts depend on ChatGPT continuing to handle the corresponding page events.

## Troubleshooting

### Draft text is missing or out of date

- Toggle `SCRIPT OFF`, verify the native composer, then toggle `SCRIPT ON` again.
- Avoid running multiple copies or older versions of the userscript simultaneously.

### Dictate stays on `STARTING` or reports `ERROR`

- Allow microphone access for ChatGPT.
- Confirm that native ChatGPT Dictate is available for your account and browser.
- Cancel the session, reload the page, and try again.

### Thinking details are empty

- Open the native Activity panel once and retry.
- Only visible Activity/Reasoning content can be mirrored.

### Older chats do not appear

- Scroll to the bottom of the Sidebar popup.
- Use `LOAD OLDER CHATS` and allow the native sidebar time to load another batch.

## Privacy

- The userscript declares `@grant none`.
- It does not make its own external network requests.
- The shell state is stored locally through `localStorage`.
- Microphone samples used by the matrix remain in the browser and are not uploaded by this script.
- Clipboard access occurs only when `COPY CODE` is activated.
- Messages, files, models, and Dictate still use ChatGPT's native controls and are therefore subject to ChatGPT's normal behavior and policies.

## License

Released under the [MIT License](./LICENSE).

## Disclaimer

This is an unofficial interface customization and is not affiliated with, endorsed by, or maintained by OpenAI. ChatGPT interface changes may require future selector and integration updates.
