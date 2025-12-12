# Forms Router

Routes to 7 specialized sub-skills for comprehensive form development.

## Sub-Skills

| Sub-Skill | Use When |
|-----------|----------|
| **accessibility** | WCAG compliance, ARIA labels, screen reader support |
| **validation** | Schema validation with Zod, error handling, async validation |
| **security** | CSRF protection, XSS prevention, secure password handling |
| **react** | React Hook Form, TanStack Form, controlled/uncontrolled inputs |
| **vue** | VeeValidate, Vuelidate, Vue form composition |
| **vanilla** | Plain JavaScript forms, no framework dependencies |
| **ux-patterns** | Multi-step wizards, conditional fields, progressive disclosure |

## Quick Decision Tree

1. **What framework?**
   - React → Load `react` sub-skill
   - Vue → Load `vue` sub-skill
   - None → Load `vanilla` sub-skill

2. **What concerns?**
   - Complex validation → Load `validation` sub-skill
   - Accessibility requirements → Load `accessibility` sub-skill
   - Security-sensitive data → Load `security` sub-skill
   - Multi-step flows → Load `ux-patterns` sub-skill

## Common Combinations

- **React + Validation**: `react` + `validation` for full-featured React forms
- **Accessible Forms**: Any framework + `accessibility` for WCAG compliance
- **Secure Auth Forms**: Any framework + `security` + `validation`
