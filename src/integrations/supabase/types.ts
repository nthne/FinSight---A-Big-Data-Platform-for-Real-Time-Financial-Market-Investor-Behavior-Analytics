export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      achievements: {
        Row: {
          achievement_id: string;
          code: string;
          condition_rule: Json;
          created_at: string;
          description: string | null;
          is_active: boolean;
          name: string;
          xp_reward: number;
        };
        Insert: {
          achievement_id?: string;
          code: string;
          condition_rule?: Json;
          created_at?: string;
          description?: string | null;
          is_active?: boolean;
          name: string;
          xp_reward?: number;
        };
        Update: {
          achievement_id?: string;
          code?: string;
          condition_rule?: Json;
          created_at?: string;
          description?: string | null;
          is_active?: boolean;
          name?: string;
          xp_reward?: number;
        };
        Relationships: [];
      };
      ai_recommendations: {
        Row: {
          confidence_score: number | null;
          content: string;
          created_at: string;
          input_features: Json;
          model_name: string | null;
          model_provider: string | null;
          recommendation_id: string;
          recommendation_type: Database["public"]["Enums"]["recommendation_type"];
          title: string | null;
          user_id: string;
        };
        Insert: {
          confidence_score?: number | null;
          content: string;
          created_at?: string;
          input_features?: Json;
          model_name?: string | null;
          model_provider?: string | null;
          recommendation_id?: string;
          recommendation_type: Database["public"]["Enums"]["recommendation_type"];
          title?: string | null;
          user_id: string;
        };
        Update: {
          confidence_score?: number | null;
          content?: string;
          created_at?: string;
          input_features?: Json;
          model_name?: string | null;
          model_provider?: string | null;
          recommendation_id?: string;
          recommendation_type?: Database["public"]["Enums"]["recommendation_type"];
          title?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      behavior_summaries: {
        Row: {
          basket_size: number | null;
          created_at: string;
          id: string;
          portfolio_value: number | null;
          summary: string;
          trade_count: number | null;
          user_id: string;
        };
        Insert: {
          basket_size?: number | null;
          created_at?: string;
          id?: string;
          portfolio_value?: number | null;
          summary: string;
          trade_count?: number | null;
          user_id: string;
        };
        Update: {
          basket_size?: number | null;
          created_at?: string;
          id?: string;
          portfolio_value?: number | null;
          summary?: string;
          trade_count?: number | null;
          user_id?: string;
        };
        Relationships: [];
      };
      behavioral_metrics: {
        Row: {
          computed_at: string;
          input_features: Json;
          metric_id: string;
          metric_name: string;
          metric_value: number;
          time_window: Database["public"]["Enums"]["time_window"];
          user_id: string;
        };
        Insert: {
          computed_at?: string;
          input_features?: Json;
          metric_id?: string;
          metric_name: string;
          metric_value: number;
          time_window?: Database["public"]["Enums"]["time_window"];
          user_id: string;
        };
        Update: {
          computed_at?: string;
          input_features?: Json;
          metric_id?: string;
          metric_name?: string;
          metric_value?: number;
          time_window?: Database["public"]["Enums"]["time_window"];
          user_id?: string;
        };
        Relationships: [];
      };
      bias_detection_results: {
        Row: {
          bias_type: string;
          detected_at: string;
          evidence: Json;
          explanation: string | null;
          result_id: string;
          score: number;
          severity: Database["public"]["Enums"]["bias_severity"];
          user_id: string;
        };
        Insert: {
          bias_type: string;
          detected_at?: string;
          evidence?: Json;
          explanation?: string | null;
          result_id?: string;
          score: number;
          severity: Database["public"]["Enums"]["bias_severity"];
          user_id: string;
        };
        Update: {
          bias_type?: string;
          detected_at?: string;
          evidence?: Json;
          explanation?: string | null;
          result_id?: string;
          score?: number;
          severity?: Database["public"]["Enums"]["bias_severity"];
          user_id?: string;
        };
        Relationships: [];
      };
      challenges: {
        Row: {
          challenge_id: string;
          challenge_type: string;
          code: string;
          created_at: string;
          description: string | null;
          end_at: string | null;
          is_active: boolean;
          reward_xp: number;
          rules: Json;
          start_at: string | null;
          title: string;
        };
        Insert: {
          challenge_id?: string;
          challenge_type: string;
          code: string;
          created_at?: string;
          description?: string | null;
          end_at?: string | null;
          is_active?: boolean;
          reward_xp?: number;
          rules?: Json;
          start_at?: string | null;
          title: string;
        };
        Update: {
          challenge_id?: string;
          challenge_type?: string;
          code?: string;
          created_at?: string;
          description?: string | null;
          end_at?: string | null;
          is_active?: boolean;
          reward_xp?: number;
          rules?: Json;
          start_at?: string | null;
          title?: string;
        };
        Relationships: [];
      };
      latest_prices: {
        Row: {
          asset_id: string;
          asset_type: Database["public"]["Enums"]["asset_type"];
          beta: number | null;
          change_percent: number;
          change_percent_1w: number;
          change_percent_1m: number;
          change_percent_1y: number;
          created_at: string;
          high_52w: number | null;
          latest_price: number;
          low_52w: number | null;
          previous_price: number | null;
          source: string;
          symbol: string;
          updated_at: string;
          volume: number | null;
        };
        Insert: {
          asset_id: string;
          asset_type: Database["public"]["Enums"]["asset_type"];
          beta?: number | null;
          change_percent?: number;
          change_percent_1w?: number;
          change_percent_1m?: number;
          change_percent_1y?: number;
          created_at?: string;
          high_52w?: number | null;
          latest_price: number;
          low_52w?: number | null;
          previous_price?: number | null;
          source: string;
          symbol: string;
          updated_at: string;
          volume?: number | null;
        };
        Update: {
          asset_id?: string;
          asset_type?: Database["public"]["Enums"]["asset_type"];
          beta?: number | null;
          change_percent?: number;
          change_percent_1w?: number;
          change_percent_1m?: number;
          change_percent_1y?: number;
          created_at?: string;
          high_52w?: number | null;
          latest_price?: number;
          low_52w?: number | null;
          previous_price?: number | null;
          source?: string;
          symbol?: string;
          updated_at?: string;
          volume?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "latest_prices_asset_id_fkey";
            columns: ["asset_id"];
            isOneToOne: true;
            referencedRelation: "market_assets";
            referencedColumns: ["asset_id"];
          },
        ];
      };
      leaderboard_entries: {
        Row: {
          computed_at: string;
          leaderboard_id: string;
          period: Database["public"]["Enums"]["time_window"];
          portfolio_value: number;
          rank: number | null;
          risk_adjusted_return: number;
          total_return: number;
          trade_count: number;
          user_id: string;
        };
        Insert: {
          computed_at?: string;
          leaderboard_id?: string;
          period: Database["public"]["Enums"]["time_window"];
          portfolio_value?: number;
          rank?: number | null;
          risk_adjusted_return?: number;
          total_return?: number;
          trade_count?: number;
          user_id: string;
        };
        Update: {
          computed_at?: string;
          leaderboard_id?: string;
          period?: Database["public"]["Enums"]["time_window"];
          portfolio_value?: number;
          rank?: number | null;
          risk_adjusted_return?: number;
          total_return?: number;
          trade_count?: number;
          user_id?: string;
        };
        Relationships: [];
      };
      market_assets: {
        Row: {
          asset_id: string;
          asset_type: Database["public"]["Enums"]["asset_type"];
          created_at: string;
          currency: string;
          data_source: string | null;
          exchange: string | null;
          is_active: boolean;
          name: string;
          provider_symbol: string | null;
          symbol: string;
          updated_at: string;
        };
        Insert: {
          asset_id?: string;
          asset_type: Database["public"]["Enums"]["asset_type"];
          created_at?: string;
          currency?: string;
          data_source?: string | null;
          exchange?: string | null;
          is_active?: boolean;
          name: string;
          provider_symbol?: string | null;
          symbol: string;
          updated_at?: string;
        };
        Update: {
          asset_id?: string;
          asset_type?: Database["public"]["Enums"]["asset_type"];
          created_at?: string;
          currency?: string;
          data_source?: string | null;
          exchange?: string | null;
          is_active?: boolean;
          name?: string;
          provider_symbol?: string | null;
          symbol?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      market_prices: {
        Row: {
          asset_id: string;
          close_price: number;
          created_at: string;
          high_price: number | null;
          low_price: number | null;
          open_price: number | null;
          price_id: string;
          source: string;
          timestamp: string;
          volume: number | null;
        };
        Insert: {
          asset_id: string;
          close_price: number;
          created_at?: string;
          high_price?: number | null;
          low_price?: number | null;
          open_price?: number | null;
          price_id?: string;
          source: string;
          timestamp: string;
          volume?: number | null;
        };
        Update: {
          asset_id?: string;
          close_price?: number;
          created_at?: string;
          high_price?: number | null;
          low_price?: number | null;
          open_price?: number | null;
          price_id?: string;
          source?: string;
          timestamp?: string;
          volume?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "market_prices_asset_id_fkey";
            columns: ["asset_id"];
            isOneToOne: false;
            referencedRelation: "market_assets";
            referencedColumns: ["asset_id"];
          },
        ];
      };
      orders: {
        Row: {
          asset_id: string | null;
          created_at: string;
          executed_at: string;
          fee: number;
          id: string;
          metadata: Json;
          order_kind: Database["public"]["Enums"]["order_kind"];
          price: number;
          qty: number;
          side: Database["public"]["Enums"]["order_side"];
          source: string;
          status: Database["public"]["Enums"]["order_status"];
          symbol: string;
          total: number;
          user_id: string;
        };
        Insert: {
          asset_id?: string | null;
          created_at?: string;
          executed_at?: string;
          fee?: number;
          id?: string;
          metadata?: Json;
          order_kind?: Database["public"]["Enums"]["order_kind"];
          price: number;
          qty: number;
          side: Database["public"]["Enums"]["order_side"];
          source?: string;
          status?: Database["public"]["Enums"]["order_status"];
          symbol: string;
          total: number;
          user_id: string;
        };
        Update: {
          asset_id?: string | null;
          created_at?: string;
          executed_at?: string;
          fee?: number;
          id?: string;
          metadata?: Json;
          order_kind?: Database["public"]["Enums"]["order_kind"];
          price?: number;
          qty?: number;
          side?: Database["public"]["Enums"]["order_side"];
          source?: string;
          status?: Database["public"]["Enums"]["order_status"];
          symbol?: string;
          total?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "orders_asset_id_fkey";
            columns: ["asset_id"];
            isOneToOne: false;
            referencedRelation: "market_assets";
            referencedColumns: ["asset_id"];
          },
        ];
      };
      portfolio_snapshots: {
        Row: {
          cash_balance: number;
          created_at: string;
          diversification_score: number | null;
          invested_value: number;
          pnl: number;
          risk_score: number | null;
          snapshot_id: string;
          snapshot_source: string;
          total_value: number;
          user_id: string;
        };
        Insert: {
          cash_balance: number;
          created_at?: string;
          diversification_score?: number | null;
          invested_value?: number;
          pnl?: number;
          risk_score?: number | null;
          snapshot_id?: string;
          snapshot_source?: string;
          total_value: number;
          user_id: string;
        };
        Update: {
          cash_balance?: number;
          created_at?: string;
          diversification_score?: number | null;
          invested_value?: number;
          pnl?: number;
          risk_score?: number | null;
          snapshot_id?: string;
          snapshot_source?: string;
          total_value?: number;
          user_id?: string;
        };
        Relationships: [];
      };
      positions: {
        Row: {
          asset_id: string | null;
          avg_cost: number;
          id: string;
          qty: number;
          symbol: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          asset_id?: string | null;
          avg_cost: number;
          id?: string;
          qty: number;
          symbol: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          asset_id?: string | null;
          avg_cost?: number;
          id?: string;
          qty?: number;
          symbol?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "positions_asset_id_fkey";
            columns: ["asset_id"];
            isOneToOne: false;
            referencedRelation: "market_assets";
            referencedColumns: ["asset_id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string | null;
          email: string | null;
          id: string;
        };
        Insert: {
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          id: string;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          id?: string;
        };
        Relationships: [];
      };
      recommendation_feedback: {
        Row: {
          comment: string | null;
          created_at: string;
          feedback_id: string;
          is_helpful: boolean | null;
          rating: number | null;
          recommendation_id: string;
          user_id: string;
        };
        Insert: {
          comment?: string | null;
          created_at?: string;
          feedback_id?: string;
          is_helpful?: boolean | null;
          rating?: number | null;
          recommendation_id: string;
          user_id: string;
        };
        Update: {
          comment?: string | null;
          created_at?: string;
          feedback_id?: string;
          is_helpful?: boolean | null;
          rating?: number | null;
          recommendation_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recommendation_feedback_recommendation_id_fkey";
            columns: ["recommendation_id"];
            isOneToOne: false;
            referencedRelation: "ai_recommendations";
            referencedColumns: ["recommendation_id"];
          },
        ];
      };
      technical_indicators: {
        Row: {
          asset_id: string;
          created_at: string;
          indicator_id: string;
          indicator_name: string;
          indicator_value: number;
          period: number | null;
          source: string;
          timestamp: string;
        };
        Insert: {
          asset_id: string;
          created_at?: string;
          indicator_id?: string;
          indicator_name: string;
          indicator_value: number;
          period?: number | null;
          source?: string;
          timestamp: string;
        };
        Update: {
          asset_id?: string;
          created_at?: string;
          indicator_id?: string;
          indicator_name?: string;
          indicator_value?: number;
          period?: number | null;
          source?: string;
          timestamp?: string;
        };
        Relationships: [
          {
            foreignKeyName: "technical_indicators_asset_id_fkey";
            columns: ["asset_id"];
            isOneToOne: false;
            referencedRelation: "market_assets";
            referencedColumns: ["asset_id"];
          },
        ];
      };
      trading_accounts: {
        Row: {
          cash: number;
          created_at: string;
          fee_rate: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          cash?: number;
          created_at?: string;
          fee_rate?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          cash?: number;
          created_at?: string;
          fee_rate?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      transactions: {
        Row: {
          asset_id: string | null;
          created_at: string;
          executed_price: number;
          fee: number;
          order_id: string | null;
          quantity: number;
          side: Database["public"]["Enums"]["order_side"];
          source: string;
          symbol: string;
          total_amount: number;
          transaction_id: string;
          user_id: string;
        };
        Insert: {
          asset_id?: string | null;
          created_at?: string;
          executed_price: number;
          fee?: number;
          order_id?: string | null;
          quantity: number;
          side: Database["public"]["Enums"]["order_side"];
          source?: string;
          symbol: string;
          total_amount: number;
          transaction_id?: string;
          user_id: string;
        };
        Update: {
          asset_id?: string | null;
          created_at?: string;
          executed_price?: number;
          fee?: number;
          order_id?: string | null;
          quantity?: number;
          side?: Database["public"]["Enums"]["order_side"];
          source?: string;
          symbol?: string;
          total_amount?: number;
          transaction_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "transactions_asset_id_fkey";
            columns: ["asset_id"];
            isOneToOne: false;
            referencedRelation: "market_assets";
            referencedColumns: ["asset_id"];
          },
          {
            foreignKeyName: "transactions_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      user_achievements: {
        Row: {
          achieved_at: string;
          achievement_id: string;
          user_achievement_id: string;
          user_id: string;
        };
        Insert: {
          achieved_at?: string;
          achievement_id: string;
          user_achievement_id?: string;
          user_id: string;
        };
        Update: {
          achieved_at?: string;
          achievement_id?: string;
          user_achievement_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_achievements_achievement_id_fkey";
            columns: ["achievement_id"];
            isOneToOne: false;
            referencedRelation: "achievements";
            referencedColumns: ["achievement_id"];
          },
        ];
      };
      user_action_logs: {
        Row: {
          action_type: string;
          asset_id: string | null;
          created_at: string;
          log_id: string;
          metadata: Json;
          symbol: string | null;
          user_id: string;
        };
        Insert: {
          action_type: string;
          asset_id?: string | null;
          created_at?: string;
          log_id?: string;
          metadata?: Json;
          symbol?: string | null;
          user_id: string;
        };
        Update: {
          action_type?: string;
          asset_id?: string | null;
          created_at?: string;
          log_id?: string;
          metadata?: Json;
          symbol?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_action_logs_asset_id_fkey";
            columns: ["asset_id"];
            isOneToOne: false;
            referencedRelation: "market_assets";
            referencedColumns: ["asset_id"];
          },
        ];
      };
      user_challenges: {
        Row: {
          challenge_id: string;
          completed_at: string | null;
          joined_at: string;
          progress: Json;
          score: number;
          status: Database["public"]["Enums"]["challenge_status"];
          user_challenge_id: string;
          user_id: string;
        };
        Insert: {
          challenge_id: string;
          completed_at?: string | null;
          joined_at?: string;
          progress?: Json;
          score?: number;
          status?: Database["public"]["Enums"]["challenge_status"];
          user_challenge_id?: string;
          user_id: string;
        };
        Update: {
          challenge_id?: string;
          completed_at?: string | null;
          joined_at?: string;
          progress?: Json;
          score?: number;
          status?: Database["public"]["Enums"]["challenge_status"];
          user_challenge_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_challenges_challenge_id_fkey";
            columns: ["challenge_id"];
            isOneToOne: false;
            referencedRelation: "challenges";
            referencedColumns: ["challenge_id"];
          },
        ];
      };
      user_roles: {
        Row: {
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      user_xp: {
        Row: {
          level: string;
          total_xp: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          level?: string;
          total_xp?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          level?: string;
          total_xp?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      get_leaderboard_public_profiles: {
        Args: Record<PropertyKey, never>;
        Returns: {
          created_at: string;
          display_name: string | null;
          id: string;
        }[];
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
    };
    Enums: {
      app_role: "admin" | "user";
      asset_type: "equity" | "crypto" | "commodity" | "etf" | "real_estate";
      bias_severity: "low" | "medium" | "high";
      challenge_status: "joined" | "completed" | "failed" | "abandoned";
      order_kind: "market" | "limit" | "stop";
      order_side: "buy" | "sell";
      order_status: "pending" | "executed" | "cancelled" | "failed";
      recommendation_type:
        | "strategy"
        | "warning"
        | "learning"
        | "portfolio"
        | "basket_review"
        | "market_overview";
      time_window: "daily" | "weekly" | "monthly" | "session";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["admin", "user"],
      asset_type: ["equity", "crypto", "commodity", "etf", "real_estate"],
      bias_severity: ["low", "medium", "high"],
      challenge_status: ["joined", "completed", "failed", "abandoned"],
      order_kind: ["market", "limit", "stop"],
      order_side: ["buy", "sell"],
      order_status: ["pending", "executed", "cancelled", "failed"],
      recommendation_type: [
        "strategy",
        "warning",
        "learning",
        "portfolio",
        "basket_review",
        "market_overview",
      ],
      time_window: ["daily", "weekly", "monthly", "session"],
    },
  },
} as const;
