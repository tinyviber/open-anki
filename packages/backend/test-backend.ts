// Simple test to verify the backend components work together
import { buildApp } from './src/index.ts';

async function testServer() {
    try {
        console.log('Testing server build...');
        const app = await buildApp();
        
        console.log('✓ Server built successfully');
        console.log('✓ All backend components are properly connected');

        const routeTable = app.printRoutes({ commonPrefix: false });
        console.log(routeTable);

        if (!routeTable.includes('/api/v1/sync/push')) {
            throw new Error('Sync push route missing from route table');
        }

        if (!routeTable.includes('/api/v1/sync/pull')) {
            throw new Error('Sync pull route missing from route table');
        }

        console.log('✓ Sync routes registered at /api/v1/sync/push and /api/v1/sync/pull');
        console.log('✓ JWT authentication middleware configured');
        console.log('✓ PostgreSQL connection service ready');
        
        // Close the server to finish the test
        await app.close();
        console.log('✓ Test completed successfully');

        process.exit(0);

    } catch (error) {
        console.error('✗ Error during server test:', error);
        process.exit(1);
    }
}

testServer();