'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { renameArtifactRequest, deleteArtifactRequest, editArtifactRequest } from '../api/catalog-client';

export function useRenameArtifactMutation(accessToken: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, title }: { slug: string; title: string }) =>
      renameArtifactRequest(slug, title, accessToken as string),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['artifact-catalog', accessToken] }),
  });
}

export function useDeleteArtifactMutation(accessToken: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => deleteArtifactRequest(slug, accessToken as string),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['artifact-catalog', accessToken] }),
  });
}

// A complex edit can legitimately take several minutes (opencode driving a real file edit) — no
// onSuccess catalog invalidation here beyond what the caller already triggers, since edit doesn't
// change the catalog listing itself (same slug, title only changes if opencode's own edit changes
// it, which the caller re-reads from the response directly rather than a refetch).
export function useEditArtifactMutation(accessToken: string | null) {
  return useMutation({
    mutationFn: ({ slug, prompt }: { slug: string; prompt: string }) =>
      editArtifactRequest(slug, prompt, accessToken as string),
  });
}
