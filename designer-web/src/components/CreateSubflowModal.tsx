import { useState } from "react";
import Modal from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function CreateSubflowModal({
  onCreate,
  onClose,
}: {
  onCreate: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const trimmed = name.trim();
  return (
    <Modal title="New subflow" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed) {
            onCreate(trimmed);
            onClose();
          }
        }}
        className="space-y-3"
      >
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            Name — saved as <span className="font-mono">flows/{trimmed || "<name>"}.json</span>
          </span>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="login"
            spellCheck={false}
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!trimmed}>
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}
