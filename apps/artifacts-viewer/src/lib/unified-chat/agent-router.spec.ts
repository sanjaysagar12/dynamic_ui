import { routeToAgent } from './agent-router';

describe('Agent Router', () => {
  describe('artifact agent routing', () => {
    it('should route artifact creation requests to artifact agent', () => {
      expect(routeToAgent('Create a React component for a todo list')).toBe('artifact');
    });

    it('should route UI generation requests to artifact agent', () => {
      expect(routeToAgent('Generate a dashboard with charts')).toBe('artifact');
    });

    it('should route design requests to artifact agent', () => {
      expect(routeToAgent('Design a landing page for my startup')).toBe('artifact');
    });

    it('should route build requests to artifact agent', () => {
      expect(routeToAgent('Build an interactive form in HTML and CSS')).toBe('artifact');
    });

    it('should route visualization requests to artifact agent', () => {
      expect(routeToAgent('Create a visualization of annual sales data')).toBe('artifact');
    });
  });

  describe('database agent routing', () => {
    it('should route database queries to db agent', () => {
      expect(routeToAgent('Select all users from the database')).toBe('db');
    });

    it('should route data fetch requests to db agent', () => {
      expect(routeToAgent('Fetch the list of products')).toBe('db');
    });

    it('should route data insert requests to db agent', () => {
      expect(routeToAgent('Insert a new customer record')).toBe('db');
    });

    it('should route data update requests to db agent', () => {
      expect(routeToAgent('Update the inventory count')).toBe('db');
    });

    it('should route data delete requests to db agent', () => {
      expect(routeToAgent('Delete inactive users')).toBe('db');
    });

    it('should route count queries to db agent', () => {
      expect(routeToAgent('Count the total number of orders')).toBe('db');
    });

    it('should route show/list requests to db agent', () => {
      expect(routeToAgent('Show me all the customers')).toBe('db');
    });
  });

  describe('edge cases', () => {
    it('should default to db agent when message has mixed keywords', () => {
      expect(routeToAgent('Create a query to select all users')).toBe('db');
    });

    it('should handle case insensitivity', () => {
      expect(routeToAgent('CREATE A DASHBOARD WITH DATA')).toBe('artifact');
    });

    it('should handle empty-ish messages', () => {
      expect(routeToAgent('hello')).toBe('db');
    });

    it('should prioritize artifact keywords in artifact-heavy messages', () => {
      expect(routeToAgent('Generate and design a beautiful UI component')).toBe('artifact');
    });

    it('should prioritize db keywords in data-heavy messages', () => {
      expect(routeToAgent('Retrieve and modify the customer database')).toBe('db');
    });
  });
});
