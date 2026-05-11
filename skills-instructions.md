# Instructions for Installing and Using Codex Skills

## 1. Installing in a New or Existing Node Project

### a. For a New Project
1. **Initialize your project:**
   ```sh
   mkdir my-codex-app && cd my-codex-app
   npm init -y
   ```
2. **Install dependencies:**
   ```sh
   npm install express ejs typescript ts-node @types/node @types/express mysql2 chart.js axios openai dotenv
   ```
3. **Initialize TypeScript:**
   ```sh
   npx tsc --init
   ```
4. **Copy `skills.md` to your project root.**

### b. For an Existing Project
1. **Install any missing dependencies:**
   ```sh
   npm install express ejs typescript ts-node @types/node @types/express mysql2 chart.js axios openai dotenv
   ```
2. **Copy or merge `skills.md` into your project root.**

## 2. Project Setup
- Set up your Express app in `src/app.ts` (or `app.js` for JS projects).
- Use EJS for views and ChartJS for chart rendering in the frontend.
- Store your OpenAI API key and other secrets in a `.env` file:
  ```env
  OPENAI_API_KEY=sk-proj-...yourkey...
  ```
- Use `dotenv` to load environment variables in your app:
  ```js
  require('dotenv').config();
  // or in TypeScript
  import 'dotenv/config';
  ```

## 3. Usage
- Reference `skills.md` for code patterns and best practices.
- Use the provided skills for:
  - Express routing and middleware
  - EJS templating
  - TypeScript type safety
  - MySQL queries and data handling
  - ChartJS data visualization
  - Fetching/parsing external API data
  - OpenAI API integration

## 4. Running the Project
- For TypeScript:
  ```sh
  npx ts-node src/app.ts
  ```
- For JavaScript:
  ```sh
  node src/app.js
  ```

## 5. Security
- **Never commit your `.env` file or API keys to public repositories.**
- Always use environment variables for sensitive data.

---

Keep `skills.md` in your project root for easy reference and onboarding new developers.
