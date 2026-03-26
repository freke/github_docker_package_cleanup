export interface PackageVersion {
  id: number;
  created_at?: string;
  updated_at: string;
  metadata?: {
    container?: {
      tags?: string[];
    };
  };
}
