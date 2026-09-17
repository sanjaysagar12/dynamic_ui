'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useSession } from '../../lib/session/session-context';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

const schema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type FormValues = z.infer<typeof schema>;
type Mode = 'login' | 'register';

export function LoginForm() {
  const router = useRouter();
  const { session, pending, error, login, register: registerAccount } = useSession();
  const [mode, setMode] = useState<Mode>('login');
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (session) router.replace('/');
  }, [session, router]);

  const onSubmit = handleSubmit(async (values) => {
    if (mode === 'login') {
      await login(values.email, values.password);
    } else {
      await registerAccount(values.email, values.password);
    }
  });

  return (
    <div className="w-full max-w-[420px] bg-surface border border-subtle rounded-xl p-9 shadow-floating">
      <div className="flex flex-col items-center text-center mb-7">
        <div className="h-11 w-11 rounded-xl bg-accent-500 flex items-center justify-center mb-4">
          <Sparkles className="h-5 w-5 text-on-accent" />
        </div>
        <h1 className="text-h1 text-primary">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <p className="text-secondary text-[13px] mt-1.5">
          {mode === 'login' ? 'Sign in to get back to your workspace.' : 'Start building pages and querying data.'}
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div>
          <label htmlFor="email" className="text-[13px] font-medium text-secondary mb-1.5 block">
            Email
          </label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            invalid={!!errors.email}
            aria-describedby={errors.email ? 'email-error' : undefined}
            {...register('email')}
          />
          {errors.email && (
            <p id="email-error" className="text-negative text-[12px] mt-1.5">
              {errors.email.message}
            </p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="password" className="text-[13px] font-medium text-secondary">
              Password
            </label>
            {mode === 'login' && (
              <button
                type="button"
                onClick={() => toast.info("Password reset isn't available yet — contact an owner to reset your password.")}
                className="text-[12px] text-accent-400 hover:underline"
              >
                Forgot password?
              </button>
            )}
          </div>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder="••••••••"
              className="pr-11"
              invalid={!!errors.password}
              aria-describedby={errors.password ? 'password-error' : undefined}
              {...register('password')}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-tertiary hover:text-secondary"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.password && (
            <p id="password-error" className="text-negative text-[12px] mt-1.5">
              {errors.password.message}
            </p>
          )}
        </div>

        {error && (
          <div className="bg-negative-soft border border-subtle rounded-md px-3 py-2.5 text-[13px] text-negative">
            {error}
          </div>
        )}

        <Button type="submit" loading={pending} className="w-full mt-1">
          {mode === 'login' ? 'Sign in' : 'Create account'}
        </Button>
      </form>

      <p className="text-center text-[13px] text-secondary mt-6">
        {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
        <button
          type="button"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
          className="text-accent-400 font-medium hover:underline"
        >
          {mode === 'login' ? 'Sign up' : 'Sign in'}
        </button>
      </p>
    </div>
  );
}
