/**
 * TODO: template listing. The Templates API exists (scope templates:read) but its endpoint
 * path was not confirmed from the docs when this was written, so nothing calls it yet.
 * Template names are configured in Settings instead; Sendiee answers an unapproved or
 * missing name with 404 TEMPLATE_NOT_FOUND, which is surfaced on the failed message.
 */
export type TemplateProvider = {
  listApprovedTemplates(): Promise<{ name: string; language: string }[]>;
};
