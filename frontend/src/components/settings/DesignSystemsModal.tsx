import { DesignSystem } from "../../types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import DesignSystemsManager from "./DesignSystemsManager";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  designSystems: DesignSystem[];
  selectedDesignSystemId: string | null;
  setSelectedDesignSystemId: (id: string | null) => void;
  initialEditingId: string | null;
  createDesignSystem: (payload: {
    name: string;
    content: string;
  }) => Promise<DesignSystem>;
  updateDesignSystem: (
    id: string,
    payload: { name?: string; content?: string }
  ) => Promise<DesignSystem>;
  deleteDesignSystem: (id: string) => Promise<void>;
}

function DesignSystemsModal({
  open,
  onOpenChange,
  designSystems,
  selectedDesignSystemId,
  setSelectedDesignSystemId,
  initialEditingId,
  createDesignSystem,
  updateDesignSystem,
  deleteDesignSystem,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Design Systems</DialogTitle>
          <DialogDescription>
            Define color, typography, and layout rules applied to every
            generation.
          </DialogDescription>
        </DialogHeader>
        <DesignSystemsManager
          designSystems={designSystems}
          selectedDesignSystemId={selectedDesignSystemId}
          setSelectedDesignSystemId={setSelectedDesignSystemId}
          initialEditingId={initialEditingId}
          createDesignSystem={createDesignSystem}
          updateDesignSystem={updateDesignSystem}
          deleteDesignSystem={deleteDesignSystem}
        />
      </DialogContent>
    </Dialog>
  );
}

export default DesignSystemsModal;
