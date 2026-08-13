import { Text } from 'ink';

interface ConfirmBarProps {
  message: string;
}

export function ConfirmBar({ message }: ConfirmBarProps) {
  return (
    <Text color="yellow">
      {message} <Text bold>(y/n)</Text>
    </Text>
  );
}
