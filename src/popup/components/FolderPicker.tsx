import { useMemo } from "react";
import { Select } from "./ui/select";
import type { BookmarkFolder } from "../types";

interface FolderPickerProps {
  folders: BookmarkFolder[];
  value: string;
  onChange: (folderId: string) => void;
  loading?: boolean;
}

interface FlatFolder {
  id: string;
  title: string;
  depth: number;
}

function flattenFolders(folders: BookmarkFolder[], depth = 0): FlatFolder[] {
  const result: FlatFolder[] = [];

  for (const folder of folders) {
    // Skip the root folder (usually has no title)
    if (folder.title || depth > 0) {
      result.push({
        id: folder.id,
        title: folder.title || "Root",
        depth,
      });
    }

    if (folder.children) {
      result.push(...flattenFolders(folder.children, folder.title ? depth + 1 : depth));
    }
  }

  return result;
}

export function FolderPicker({
  folders,
  value,
  onChange,
  loading,
}: FolderPickerProps) {
  const flatFolders = useMemo(() => flattenFolders(folders), [folders]);

  if (loading) {
    return (
      <div className="h-8 animate-pulse rounded-[10px] bg-white/[0.06]" />
    );
  }

  return (
    <Select value={value} onValueChange={onChange}>
      {flatFolders.map((folder) => (
        <option key={folder.id} value={folder.id}>
          {"  ".repeat(folder.depth)}{folder.title}
        </option>
      ))}
    </Select>
  );
}
