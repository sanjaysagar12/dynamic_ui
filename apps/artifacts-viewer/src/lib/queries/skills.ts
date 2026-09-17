'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchSkills, createSkill, updateSkill, deleteSkill } from '../api/skills-client';
import type { CreateSkillPayload, UpdateSkillPayload } from '../skills/types';

export function useSkillsQuery() {
  return useQuery({ queryKey: ['skills'], queryFn: fetchSkills });
}

export function useCreateSkillMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateSkillPayload) => createSkill(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  });
}

export function useUpdateSkillMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, payload }: { name: string; payload: UpdateSkillPayload }) => updateSkill(name, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  });
}

export function useDeleteSkillMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => deleteSkill(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  });
}
