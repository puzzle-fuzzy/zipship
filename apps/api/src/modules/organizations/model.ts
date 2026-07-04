import { t } from "elysia";

export const organizationsHeadersModel = t.Object({
  authorization: t.Optional(t.String()),
});

export const organizationListModel = t.Object({
  organizations: t.Array(
    t.Object({
      id: t.String(),
      name: t.String(),
      slug: t.String(),
      role: t.Literal("owner"),
    }),
  ),
});

export const organizationErrorModel = t.Object({
  code: t.Literal("UNAUTHORIZED"),
});

export const organizationModels = {
  "Organizations.Headers": organizationsHeadersModel,
  "Organizations.List": organizationListModel,
  "Organizations.Error": organizationErrorModel,
};

export type OrganizationsHeaders = typeof organizationsHeadersModel.static;
export type OrganizationList = typeof organizationListModel.static;

export class OrganizationServiceError {
  constructor(public readonly code: "UNAUTHORIZED") {}
}

export class OrganizationUnauthorizedError extends OrganizationServiceError {
  constructor() {
    super("UNAUTHORIZED");
  }
}
