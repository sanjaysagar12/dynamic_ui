'use client';

import { ROLES, type Role } from '@org/shared-auth';

export interface RoleSwitcherProps {
  role: Role;
  onChange: (role: Role) => void;
}

export function RoleSwitcher({ role, onChange }: RoleSwitcherProps) {
  return (
    <fieldset>
      <legend>Role</legend>
      {ROLES.map((option) => (
        <label key={option} style={{ marginRight: '1rem' }}>
          <input
            type="radio"
            name="role"
            value={option}
            checked={role === option}
            onChange={() => onChange(option)}
          />
          {option}
        </label>
      ))}
    </fieldset>
  );
}
