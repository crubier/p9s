import { expect, test, describe } from "bun:test";
import {
  validateConfig,
  validateCompleteConfig,
  parseConfig,
  parseCompleteConfig,
  getValidationErrors,
} from "./validation";

describe("Configuration Validation", () => {
  describe("validateConfig", () => {
    test("[valid] empty config", () => {
      const result = validateConfig({});
      expect(result.success).toBe(true);
    });

    test("[valid] minimal config with just engine.users", () => {
      const result = validateConfig({
        engine: {
          users: ["admin", "user"],
        },
      });
      expect(result.success).toBe(true);
    });

    test("[valid] config with tables", () => {
      const result = validateConfig({
        tables: [
          {
            name: "posts",
            isResource: true,
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    test("[invalid] invalid engine.id.mode", () => {
      const result = validateConfig({
        engine: {
          id: {
            mode: "invalid" as any,
          },
        },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.issues.length).toBeGreaterThan(0);
      }
    });

    test("[invalid] invalid combineAssignmentsWith value", () => {
      const result = validateConfig({
        engine: {
          combineAssignmentsWith: "invalid" as any,
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("validateCompleteConfig", () => {
    const validCompleteConfig = {
      engine: {
        schema: "public",
        users: ["admin", "user"],
        permission: {
          bitmap: { size: 128 },
          maxDepth: { resource: 16, role: 16 },
        },
        authentication: { getCurrentUserId: "get_current_user_id" },
        id: { mode: "integer" as const },
        combineAssignmentsWith: "none" as const,
        naming: {},
      },
      migration: {
        output: { sql: "migration.sql" },
      },
      tables: [],
    };

    test("[valid] valid complete config", () => {
      const result = validateCompleteConfig(validCompleteConfig);
      expect(result.success).toBe(true);
    });

    test("[invalid] config with bitmap size too small", () => {
      const result = validateCompleteConfig({
        ...validCompleteConfig,
        engine: {
          ...validCompleteConfig.engine,
          permission: {
            ...validCompleteConfig.engine.permission,
            bitmap: { size: 0 },
          },
        },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const errors = getValidationErrors(result);
        expect(errors.some((e) => e.includes("Bitmap size"))).toBe(true);
      }
    });

    test("[invalid] config with bitmap size too large", () => {
      const result = validateCompleteConfig({
        ...validCompleteConfig,
        engine: {
          ...validCompleteConfig.engine,
          permission: {
            ...validCompleteConfig.engine.permission,
            bitmap: { size: 2000 },
          },
        },
      });
      expect(result.success).toBe(false);
    });

    test("[invalid] config with invalid maxDepth.resource", () => {
      const result = validateCompleteConfig({
        ...validCompleteConfig,
        engine: {
          ...validCompleteConfig.engine,
          permission: {
            ...validCompleteConfig.engine.permission,
            maxDepth: { resource: 0, role: 16 },
          },
        },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const errors = getValidationErrors(result);
        expect(errors.some((e) => e.includes("Resource max depth"))).toBe(true);
      }
    });

    test("[invalid] config with invalid maxDepth.role", () => {
      const result = validateCompleteConfig({
        ...validCompleteConfig,
        engine: {
          ...validCompleteConfig.engine,
          permission: {
            ...validCompleteConfig.engine.permission,
            maxDepth: { resource: 16, role: 0 },
          },
        },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const errors = getValidationErrors(result);
        expect(errors.some((e) => e.includes("Role max depth"))).toBe(true);
      }
    });

    test("[invalid] config with permission user not in users array", () => {
      const result = validateCompleteConfig({
        ...validCompleteConfig,
        tables: [
          {
            schema: "public",
            name: "posts",
            isResource: true,
            resourceId: "resource_id",
            resourceFkey: "resource_fkey",
            isRole: false,
            roleId: "role_id",
            roleFkey: "role_fkey",
            permission: {
              unknown_user: {
                select: 1,
                insert: 1,
                update: 1,
                delete: 1,
              },
            },
          },
        ],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const errors = getValidationErrors(result);
        expect(errors.some((e) => e.includes("unknown_user"))).toBe(true);
      }
    });

    test("[valid] config with valid permission users", () => {
      const result = validateCompleteConfig({
        ...validCompleteConfig,
        tables: [
          {
            schema: "public",
            name: "posts",
            isResource: true,
            resourceId: "resource_id",
            resourceFkey: "resource_fkey",
            isRole: false,
            roleId: "role_id",
            roleFkey: "role_fkey",
            permission: {
              admin: {
                select: 1,
                insert: 1,
                update: 1,
                delete: 1,
              },
              user: {
                select: 1,
                insert: 0,
                update: 0,
                delete: 0,
              },
            },
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    test("[invalid] config missing required fields", () => {
      const result = validateCompleteConfig({
        engine: {
          schema: "public",
          // missing other required fields
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("parseConfig", () => {
    test("[valid] returns parsed config on valid input", () => {
      const config = parseConfig({
        engine: { users: ["admin"] },
      });
      expect(config.engine?.users).toEqual(["admin"]);
    });

    test("[invalid] throws on invalid input", () => {
      expect(() =>
        parseConfig({
          engine: { id: { mode: "invalid" } },
        })
      ).toThrow();
    });
  });

  describe("parseCompleteConfig", () => {
    test("[invalid] throws on incomplete config", () => {
      expect(() => parseCompleteConfig({})).toThrow();
    });
  });

  describe("getValidationErrors", () => {
    test("[valid] returns empty array for successful validation", () => {
      const result = validateConfig({});
      const errors = getValidationErrors(result);
      expect(errors).toEqual([]);
    });

    test("[invalid] returns formatted error messages", () => {
      const result = validateConfig({
        engine: { id: { mode: "invalid" } },
      });
      const errors = getValidationErrors(result);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("engine.id.mode");
    });
  });
});

describe("Real-world Configuration Examples", () => {
  test("[valid] blog application config", () => {
    const result = validateCompleteConfig({
      engine: {
        schema: "public",
        users: ["postgres", "authenticated", "anonymous"],
        permission: {
          bitmap: { size: 4 },
          maxDepth: { resource: 8, role: 8 },
        },
        authentication: { getCurrentUserId: "current_user_id" },
        id: { mode: "uuid" },
        combineAssignmentsWith: "none",
        naming: {},
      },
      migration: {
        output: { sql: "blog-migration.sql" },
      },
      tables: [
        {
          schema: "public",
          name: "users",
          isResource: false,
          resourceId: "",
          resourceFkey: "",
          isRole: true,
          roleId: "id",
          roleFkey: "user_fkey",
          permission: {},
        },
        {
          schema: "public",
          name: "posts",
          isResource: true,
          resourceId: "id",
          resourceFkey: "post_fkey",
          isRole: false,
          roleId: "",
          roleFkey: "",
          permission: {
            postgres: { select: 1, insert: 1, update: 1, delete: 1 },
            authenticated: { select: 1, insert: 1, update: 1, delete: 1 },
            anonymous: { select: 1, insert: 0, update: 0, delete: 0 },
          },
        },
        {
          schema: "public",
          name: "comments",
          isResource: true,
          resourceId: "id",
          resourceFkey: "comment_fkey",
          isRole: false,
          roleId: "",
          roleFkey: "",
          permission: {
            postgres: { select: 1, insert: 1, update: 1, delete: 1 },
            authenticated: { select: 1, insert: 1, update: 1, delete: 1 },
            anonymous: { select: 1, insert: 0, update: 0, delete: 0 },
          },
        },
        {
          schema: "public",
          name: "categories",
          isResource: true,
          resourceId: "id",
          resourceFkey: "category_fkey",
          isRole: false,
          roleId: "",
          roleFkey: "",
          permission: {
            postgres: { select: 1, insert: 1, update: 1, delete: 1 },
            authenticated: { select: 1, insert: 0, update: 0, delete: 0 },
            anonymous: { select: 1, insert: 0, update: 0, delete: 0 },
          },
        },
        {
          schema: "public",
          name: "tags",
          isResource: true,
          resourceId: "id",
          resourceFkey: "tag_fkey",
          isRole: false,
          roleId: "",
          roleFkey: "",
          permission: {
            postgres: { select: 1, insert: 1, update: 1, delete: 1 },
            authenticated: { select: 1, insert: 0, update: 0, delete: 0 },
            anonymous: { select: 1, insert: 0, update: 0, delete: 0 },
          },
        },
        {
          schema: "public",
          name: "post_tags",
          isResource: false,
          resourceId: "",
          resourceFkey: "",
          isRole: false,
          roleId: "",
          roleFkey: "",
          permission: {
            postgres: { select: 1, insert: 1, update: 1, delete: 1 },
            authenticated: { select: 1, insert: 1, update: 0, delete: 1 },
            anonymous: { select: 1, insert: 0, update: 0, delete: 0 },
          },
        },
        {
          schema: "public",
          name: "media",
          isResource: true,
          resourceId: "id",
          resourceFkey: "media_fkey",
          isRole: false,
          roleId: "",
          roleFkey: "",
          permission: {
            postgres: { select: 1, insert: 1, update: 1, delete: 1 },
            authenticated: { select: 1, insert: 1, update: 1, delete: 1 },
            anonymous: { select: 1, insert: 0, update: 0, delete: 0 },
          },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  test("[valid] multi-tenant SaaS config", () => {
    const result = validateCompleteConfig({
      engine: {
        schema: "app",
        users: ["service_role", "tenant_admin", "tenant_user"],
        permission: {
          bitmap: { size: 16 },
          maxDepth: { resource: 32, role: 16 },
        },
        authentication: { getCurrentUserId: "auth.uid" },
        id: { mode: "uuid" },
        combineAssignmentsWith: "role",
        naming: {
          prefix: "p9s_",
        },
      },
      migration: {
        output: { sql: "saas-permissions.sql" },
      },
      tables: [
        {
          schema: "app",
          name: "organizations",
          isResource: true,
          resourceId: "id",
          resourceFkey: "org_fkey",
          isRole: false,
          roleId: "",
          roleFkey: "",
          permission: {
            service_role: { select: 1, insert: 1, update: 1, delete: 1 },
            tenant_admin: { select: 1, insert: 0, update: 1, delete: 0 },
            tenant_user: { select: 1, insert: 0, update: 0, delete: 0 },
          },
        },
        {
          schema: "app",
          name: "teams",
          isResource: true,
          resourceId: "id",
          resourceFkey: "team_fkey",
          isRole: true,
          roleId: "id",
          roleFkey: "team_role_fkey",
          permission: {
            service_role: { select: 1, insert: 1, update: 1, delete: 1 },
            tenant_admin: { select: 1, insert: 1, update: 1, delete: 1 },
            tenant_user: { select: 1, insert: 0, update: 0, delete: 0 },
          },
        },
        {
          schema: "app",
          name: "users",
          isResource: false,
          resourceId: "",
          resourceFkey: "",
          isRole: true,
          roleId: "id",
          roleFkey: "user_fkey",
          permission: {
            service_role: { select: 1, insert: 1, update: 1, delete: 1 },
            tenant_admin: { select: 1, insert: 1, update: 1, delete: 0 },
            tenant_user: { select: 1, insert: 0, update: 0, delete: 0 },
          },
        },
        {
          schema: "app",
          name: "projects",
          isResource: true,
          resourceId: "id",
          resourceFkey: "project_fkey",
          isRole: false,
          roleId: "",
          roleFkey: "",
          permission: {
            service_role: { select: 1, insert: 1, update: 1, delete: 1 },
            tenant_admin: { select: 1, insert: 1, update: 1, delete: 1 },
            tenant_user: { select: 1, insert: 1, update: 1, delete: 0 },
          },
        },
        {
          schema: "app",
          name: "documents",
          isResource: true,
          resourceId: "id",
          resourceFkey: "document_fkey",
          isRole: false,
          roleId: "",
          roleFkey: "",
          permission: {
            service_role: { select: 1, insert: 1, update: 1, delete: 1 },
            tenant_admin: { select: 1, insert: 1, update: 1, delete: 1 },
            tenant_user: { select: 1, insert: 1, update: 1, delete: 1 },
          },
        },
        {
          schema: "app",
          name: "invoices",
          isResource: true,
          resourceId: "id",
          resourceFkey: "invoice_fkey",
          isRole: false,
          roleId: "",
          roleFkey: "",
          permission: {
            service_role: { select: 1, insert: 1, update: 1, delete: 1 },
            tenant_admin: { select: 1, insert: 1, update: 1, delete: 0 },
            tenant_user: { select: 1, insert: 0, update: 0, delete: 0 },
          },
        },
        {
          schema: "app",
          name: "subscriptions",
          isResource: true,
          resourceId: "id",
          resourceFkey: "subscription_fkey",
          isRole: false,
          roleId: "",
          roleFkey: "",
          permission: {
            service_role: { select: 1, insert: 1, update: 1, delete: 1 },
            tenant_admin: { select: 1, insert: 0, update: 0, delete: 0 },
            tenant_user: { select: 0, insert: 0, update: 0, delete: 0 },
          },
        },
        {
          schema: "app",
          name: "audit_logs",
          isResource: true,
          resourceId: "id",
          resourceFkey: "audit_log_fkey",
          isRole: false,
          roleId: "",
          roleFkey: "",
          permission: {
            service_role: { select: 1, insert: 1, update: 0, delete: 0 },
            tenant_admin: { select: 1, insert: 0, update: 0, delete: 0 },
            tenant_user: { select: 0, insert: 0, update: 0, delete: 0 },
          },
        },
        {
          schema: "app",
          name: "api_keys",
          isResource: true,
          resourceId: "id",
          resourceFkey: "api_key_fkey",
          isRole: false,
          roleId: "",
          roleFkey: "",
          permission: {
            service_role: { select: 1, insert: 1, update: 1, delete: 1 },
            tenant_admin: { select: 1, insert: 1, update: 1, delete: 1 },
            tenant_user: { select: 0, insert: 0, update: 0, delete: 0 },
          },
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
