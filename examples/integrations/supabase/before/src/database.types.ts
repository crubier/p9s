// The tables of the app, as `supabase gen types typescript` writes them

export type Access = "viewer" | "editor" | "owner";

type Table<Row, Insert> = { Row: Row; Insert: Insert; Update: Partial<Insert>; Relationships: [] };

export type Database = {
  public: {
    Tables: {
      users: Table<{ id: number; name: string }, { id?: number; name: string }>;
      teams: Table<{ id: number; name: string }, { id?: number; name: string }>;
      team_members: Table<{ team_id: number; user_id: number }, { team_id: number; user_id: number }>;
      projects: Table<{ id: number; name: string }, { id?: number; name: string }>;
      project_shares: Table<{ project_id: number; team_id: number; access: Access }, { project_id: number; team_id: number; access: Access }>;
      documents: Table<{ id: number; project_id: number; title: string; body: string }, { id?: number; project_id: number; title: string; body?: string }>;
      document_shares: Table<{ document_id: number; user_id: number; access: Exclude<Access, "owner"> }, { document_id: number; user_id: number; access: Exclude<Access, "owner"> }>;
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
