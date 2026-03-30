import type {
  AIProvider,
  DecisionCategory,
  DecisionStatus,
  DocStatus,
  DocType,
  IdeaCategory,
  IdeaSourceType,
  IdeaStatus,
  MemoryCategory,
  MemorySource,
  PlanTier,
  Priority,
  ProjectStatus,
  Relationship,
  TaskType,
} from "@/lib/types/domain";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string | null;
          full_name: string | null;
          active_tier: PlanTier;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          full_name?: string | null;
          active_tier?: PlanTier;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          full_name?: string | null;
          active_tier?: PlanTier;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tasks: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          description: string;
          type: TaskType;
          priority: Priority;
          how_to: string;
          recommended_ai: AIProvider;
          recommended_model: string;
          ai_reason: string;
          selected_model: string | null;
          audit_notes: string;
          memory_key: string;
          status: "open" | "done";
          source_text: string;
          project_id: string | null;
          delegated_to: string | null;
          is_open_loop: boolean;
          thread_ref: string | null;
          linear_issue_id: string | null;
          linear_url: string | null;
          linear_synced_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          description?: string;
          type: TaskType;
          priority: Priority;
          how_to?: string;
          recommended_ai: AIProvider;
          recommended_model: string;
          ai_reason: string;
          selected_model?: string | null;
          audit_notes?: string;
          memory_key?: string;
          status?: "open" | "done";
          source_text?: string;
          project_id?: string | null;
          delegated_to?: string | null;
          is_open_loop?: boolean;
          thread_ref?: string | null;
          linear_issue_id?: string | null;
          linear_url?: string | null;
          linear_synced_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["tasks"]["Insert"]>;
        Relationships: [];
      };
      task_messages: {
        Row: {
          id: string;
          task_id: string;
          user_id: string;
          model_id: string;
          role: "user" | "assistant";
          content: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          user_id: string;
          model_id: string;
          role: "user" | "assistant";
          content: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["task_messages"]["Insert"]>;
        Relationships: [];
      };
      user_api_keys: {
        Row: {
          id: string;
          user_id: string;
          provider: AIProvider;
          encrypted_key: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          provider: AIProvider;
          encrypted_key: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["user_api_keys"]["Insert"]>;
        Relationships: [];
      };
      subscriptions: {
        Row: {
          id: string;
          user_id: string;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          stripe_price_id: string | null;
          status: string;
          tier: PlanTier;
          current_period_end: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          stripe_price_id?: string | null;
          status?: string;
          tier?: PlanTier;
          current_period_end?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["subscriptions"]["Insert"]>;
        Relationships: [];
      };
      usage_counters: {
        Row: {
          id: string;
          user_id: string;
          month_key: string;
          tasks_created: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          month_key: string;
          tasks_created?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["usage_counters"]["Insert"]>;
        Relationships: [];
      };
      memories: {
        Row: {
          id: string;
          user_id: string;
          content: string;
          summary: string;
          category: MemoryCategory;
          source: MemorySource;
          source_id: string | null;
          tags: string[];
          importance: number;
          last_accessed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          content: string;
          summary?: string;
          category?: MemoryCategory;
          source?: MemorySource;
          source_id?: string | null;
          tags?: string[];
          importance?: number;
          last_accessed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["memories"]["Insert"]>;
        Relationships: [];
      };
      decisions: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          description: string;
          context: string;
          reasoning: string;
          outcome: string;
          alternatives: string[];
          status: DecisionStatus;
          category: DecisionCategory;
          decided_at: string | null;
          review_at: string | null;
          project_id: string | null;
          tags: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          description?: string;
          context?: string;
          reasoning?: string;
          outcome?: string;
          alternatives?: string[];
          status?: DecisionStatus;
          category?: DecisionCategory;
          decided_at?: string | null;
          review_at?: string | null;
          project_id?: string | null;
          tags?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["decisions"]["Insert"]>;
        Relationships: [];
      };
      projects: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          slug: string;
          description: string;
          status: ProjectStatus;
          priority: Priority;
          goals: string[];
          due_date: string | null;
          completed_at: string | null;
          tags: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          slug?: string;
          description?: string;
          status?: ProjectStatus;
          priority?: Priority;
          goals?: string[];
          due_date?: string | null;
          completed_at?: string | null;
          tags?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["projects"]["Insert"]>;
        Relationships: [];
      };
      people: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          email: string | null;
          phone: string | null;
          company: string | null;
          role: string;
          relationship: Relationship;
          notes: string;
          commitments: string[];
          last_contact_at: string | null;
          tags: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          email?: string | null;
          phone?: string | null;
          company?: string | null;
          role?: string;
          relationship?: Relationship;
          notes?: string;
          commitments?: string[];
          last_contact_at?: string | null;
          tags?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["people"]["Insert"]>;
        Relationships: [];
      };
      ideas: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          description: string;
          source_type: IdeaSourceType;
          status: IdeaStatus;
          category: IdeaCategory;
          project_id: string | null;
          tags: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          description?: string;
          source_type?: IdeaSourceType;
          status?: IdeaStatus;
          category?: IdeaCategory;
          project_id?: string | null;
          tags?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["ideas"]["Insert"]>;
        Relationships: [];
      };
      meetings: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          description: string;
          summary: string;
          notes: string;
          action_items: string[];
          extracted_task_ids: string[];
          attendee_ids: string[];
          project_id: string | null;
          calendar_event_id: string | null;
          meeting_at: string;
          duration_minutes: number | null;
          location: string;
          tags: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          description?: string;
          summary?: string;
          notes?: string;
          action_items?: string[];
          extracted_task_ids?: string[];
          attendee_ids?: string[];
          project_id?: string | null;
          calendar_event_id?: string | null;
          meeting_at?: string;
          duration_minutes?: number | null;
          location?: string;
          tags?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["meetings"]["Insert"]>;
        Relationships: [];
      };
      documents: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          content: string;
          doc_type: DocType;
          status: DocStatus;
          drive_file_id: string | null;
          chunk_index: number;
          parent_doc_id: string | null;
          project_id: string | null;
          tags: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          content?: string;
          doc_type?: DocType;
          status?: DocStatus;
          drive_file_id?: string | null;
          chunk_index?: number;
          parent_doc_id?: string | null;
          project_id?: string | null;
          tags?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["documents"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      search_by_embedding: {
        Args: {
          p_user_id: string;
          p_table_name: string;
          p_embedding: string;
          p_match_count?: number;
          p_match_threshold?: number;
        };
        Returns: { id: string; similarity: number }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
