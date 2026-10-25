# AI-Personal-Agent (PlanAI)

Live Demo : https://guru-personal-planner.netlify.app/

**PlanAI** is a web-based AI personal planner. You describe a goal in plain English, for example *"I have an exam in 18 days and haven't started"*, and it builds a day-by-day plan around the hours you are free. When you miss sessions, it moves them to upcoming days that still have room.

It is a static front-end app (HTML, CSS and JavaScript) with no backend. Everything you enter is kept in your own browser.

## Features

* **Onboarding** in three steps: your name (and an optional Gemini API key), the hours you are free on each weekday plus your preferred session length (25, 45, 60 or 90 minutes), and any existing commitments such as "Gym Mon/Wed/Fri 7pm"
* **AI Chat** that turns a goal into a plan you can review, regenerate or save
* **Dashboard** with a time-of-day greeting, today's tasks, overall progress and a study streak
* **My Plans** with a calendar for each plan and the tasks for any day you select
* **Auto-reschedule** for sessions you missed
* **Settings** for your name, API key, Gemini model, session length and weekly hours
* **Reset Planner** to wipe everything stored in the browser
* Works without an API key (see below)

## How it works

### Two ways to generate a plan

| Mode | When | What happens |
|---|---|---|
| **Gemini** | You entered a Gemini API key | The app sends your goal, your free hours, session length and commitments to the Gemini API and asks for a JSON plan. If a day's sessions add up to more than your free time, they are scaled down to fit |
| **Local** | No key, or the Gemini call fails | A built-in generator makes the plan with no network call |

The local generator reads the number of days, weeks or months from your message (default 18 days, limited to 3 to 90) and picks a template from keywords in it: exam prep, music practice, fitness training, writing, learning to code, or a generic goal plan. Each template moves through five phases, for example Foundation, Core concepts, Practice problems, Review & mock tests and Final revision. Days with no free hours become rest days, and each day gets 1 to 3 sessions.

### Rescheduling missed sessions

Sessions from past days that were not marked done are treated as missed. They are removed from those days and placed on upcoming days, in order, wherever that weekday still has free time left. Anything that still does not fit is added to the last day that received sessions.

### Streak

The streak goes up by one when you completed at least one session the previous day. If you skipped a day it resets to zero.

### Where your data lives

Your profile, free hours, commitments, plans and streak are saved in `localStorage` under the key `planai_state`. Nothing is sent to a server owned by this project. Clearing site data or pressing **Reset Planner** deletes it.

## Using Gemini (optional)

1. Create a Gemini API key in Google AI Studio.
2. Paste it into the key field during onboarding, or later under **Settings > AI Configuration**.
3. Choose a model in **Settings**. The list includes `gemini-3.6-flash` (the default), `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.0-flash`, `gemini-1.5-flash` and `gemini-2.5-pro`. Your key must have access to the model you pick.

**About the key:** it is stored in your browser's `localStorage` and the request goes straight from your browser to `generativelanguage.googleapis.com`, with the key in the URL. That is fine for a personal project, but do not use a key with a high spending limit, do not enter it on a shared computer, and do not hard-code a key into `app.js`.

## Run it locally

No build step or install is needed.

1. Clone the repository.
2. Open `index.html` in a browser, or serve the folder (for example `python3 -m http.server 8000`) and open http://localhost:8000.

## Project structure

```
index.html        Page markup: onboarding, dashboard, plans, chat, settings, modals
style.css         All styles
app.js            All logic: state and storage, onboarding, navigation, dashboard,
                  plan calendar, rescheduling, chat, Gemini call, local plan generator
requirements.txt  See the note below
```

## Technologies Used

* HTML5
* CSS3
* JavaScript (ES6+)
* Google Gemini API (optional)
* Netlify (Deployment Platform)

## Deployment

The app is deployed on Netlify as a static site, so it can be opened in a browser with nothing to install. Any static host works, because there is no server code.

## Notes

* `requirements.txt` lists `Netlify`, `google-genai`, `Java-Script`, `CSS` and `HTML`. These are not Python packages and nothing in this project uses `google-genai`: the app calls the Gemini REST API directly from the browser. The file can be ignored.
* There are no automated tests yet.
* Plans are tied to one browser. Opening the site on another device or browser starts fresh.
