import type { Config } from "@p9s/core";

const config: Config<"app_user"> = {
  engine: {
    users: ["app_user"],
    permission: {
      bitmap: {
        size: 64
      }
    },
    authentication: {
      getCurrentUserId: "get_current_user_id"
    },
    id: {
      mode: "integer"
    }
  },
  tables: [{
    name: "folder",
    isResource: true,
    permission: {
      app_user: {
        select: 0,
        insert: 1,
        update: 2,
        delete: 3
      }
    }
  }]
};

export default config;
