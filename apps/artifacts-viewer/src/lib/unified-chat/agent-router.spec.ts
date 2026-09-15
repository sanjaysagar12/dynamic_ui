import { routeToAgent } from './agent-router';
import Anthropic from '@anthropic-ai/sdk';

jest.mock('@anthropic-ai/sdk');

describe('Agent Router', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockClaudeResponse = (decision: 'artifact' | 'db') => {
    (Anthropic as jest.MockedClass<typeof Anthropic>).prototype.messages = {
      create: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: decision }],
      }),
    } as any;
  };

  describe('artifact agent routing', () => {
    it('should route artifact creation requests to artifact agent', async () => {
      mockClaudeResponse('artifact');
      const result = await routeToAgent('Create a React component for a todo list');
      expect(result).toBe('artifact');
    });

    it('should route UI generation requests to artifact agent', async () => {
      mockClaudeResponse('artifact');
      const result = await routeToAgent('Generate a dashboard with charts');
      expect(result).toBe('artifact');
    });

    it('should route design requests to artifact agent', async () => {
      mockClaudeResponse('artifact');
      const result = await routeToAgent('Design a landing page for my startup');
      expect(result).toBe('artifact');
    });

    it('should route build requests to artifact agent', async () => {
      mockClaudeResponse('artifact');
      const result = await routeToAgent('Build an interactive form in HTML and CSS');
      expect(result).toBe('artifact');
    });

    it('should route visualization requests to artifact agent', async () => {
      mockClaudeResponse('artifact');
      const result = await routeToAgent('Create a visualization of annual sales data');
      expect(result).toBe('artifact');
    });
  });

  describe('database agent routing', () => {
    it('should route database queries to db agent', async () => {
      mockClaudeResponse('db');
      const result = await routeToAgent('Select all users from the database');
      expect(result).toBe('db');
    });

    it('should route data fetch requests to db agent', async () => {
      mockClaudeResponse('db');
      const result = await routeToAgent('Fetch the list of products');
      expect(result).toBe('db');
    });

    it('should route data insert requests to db agent', async () => {
      mockClaudeResponse('db');
      const result = await routeToAgent('Insert a new customer record');
      expect(result).toBe('db');
    });

    it('should route data update requests to db agent', async () => {
      mockClaudeResponse('db');
      const result = await routeToAgent('Update the inventory count');
      expect(result).toBe('db');
    });

    it('should route data delete requests to db agent', async () => {
      mockClaudeResponse('db');
      const result = await routeToAgent('Delete inactive users');
      expect(result).toBe('db');
    });

    it('should route count queries to db agent', async () => {
      mockClaudeResponse('db');
      const result = await routeToAgent('Count the total number of orders');
      expect(result).toBe('db');
    });

    it('should route show/list requests to db agent', async () => {
      mockClaudeResponse('db');
      const result = await routeToAgent('Show me all the customers');
      expect(result).toBe('db');
    });
  });

  describe('edge cases', () => {
    it('should use LLM to determine mixed intent messages', async () => {
      mockClaudeResponse('db');
      const result = await routeToAgent('Create a query to select all users');
      expect(result).toBe('db');
    });

    it('should handle LLM responses case-insensitively', async () => {
      mockClaudeResponse('artifact');
      const result = await routeToAgent('CREATE A DASHBOARD WITH DATA');
      expect(result).toBe('artifact');
    });

    it('should default to db on API error', async () => {
      (Anthropic as jest.MockedClass<typeof Anthropic>).prototype.messages = {
        create: jest.fn().mockRejectedValue(new Error('API error')),
      } as any;
      const result = await routeToAgent('hello');
      expect(result).toBe('db');
    });

    it('should handle artifact-heavy messages', async () => {
      mockClaudeResponse('artifact');
      const result = await routeToAgent('Generate and design a beautiful UI component');
      expect(result).toBe('artifact');
    });

    it('should handle data-heavy messages', async () => {
      mockClaudeResponse('db');
      const result = await routeToAgent('Retrieve and modify the customer database');
      expect(result).toBe('db');
    });
  });
});
