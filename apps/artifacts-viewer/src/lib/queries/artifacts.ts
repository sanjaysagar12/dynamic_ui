'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { renameArtifactRequest, deleteArtifactRequest } from '../api/catalog-client';

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
