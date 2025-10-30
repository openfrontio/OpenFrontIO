// Shared generic preset type to ensure consistency across modals/managers
export type Preset<TSettings = unknown> = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  settings: TSettings;
};
