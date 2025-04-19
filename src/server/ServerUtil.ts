import { Archive } from "../server/Archive";
import { MemoryArchive } from "../server/MemoryArchive";
import { S3Archive } from "../server/S3Archive";

let archive: Archive | null = null;

export function getArchive(use_memory: boolean = false): Archive {
  if (archive) {
    return archive; // singleton
  }

  if (use_memory) {
    archive = new MemoryArchive();
  } else {
    archive = new S3Archive();
  }

  return archive;
}
