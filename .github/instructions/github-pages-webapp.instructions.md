---
title: Github Pages Creater WebApplications HTML5/JS/CSS
scope: global
appliesTo:
  - "**/*.html"
  - "**/*.js"
  - "**/*.css"
ruleType: hard
---

# Github Pages Creater WebApplications HTML5/JS/CSS Instructions

## Rule
All web applications intended for Github Pages must:
- Use only HTML5, vanilla JavaScript (no frameworks), and CSS3.
- Be fully static (no server-side code).
- Ensure compatibility with modern browsers (Edge, Chrome, Firefox, Safari).
- Avoid external dependencies unless loaded via CDN and compatible with Github Pages.
- Include a `README.md` with deployment instructions for Github Pages.
- Use semantic HTML5 elements and accessible markup.
- Organize code with clear separation of HTML, JS, and CSS files.

## Rationale
This ensures that all web applications are easily deployable to Github Pages, are maintainable, and follow best practices for static web development.

## Example Prompts
- "Create a new static web app for Github Pages using only HTML5, JS, and CSS."
- "Add a deployment section to the README for Github Pages."
- "Refactor to remove any server-side code."

## Related Customizations
- Enforce code linting for HTML, JS, and CSS.
- Add accessibility checks to the workflow.
- Provide a template README for Github Pages deployment.
