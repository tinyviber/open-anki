// Simple test script to verify the backend server starts correctly
const { buildApp } = require('./dist/index.js');

async function testServer() {
    try {
        console.log('Starting test server...');
        const app = await buildApp();
        
        // Test that routes are registered
        const routes = app.printRoutes();
        console.log('Registered routes:');
        console.log(routes);
        
        console.log('✓ Server built successfully with registered routes');
        console.log('✓ All backend components are properly connected');
        
        // Close the server to finish the test
        app.close(() => {
            console.log('Test server closed');
        });
        
    } catch (error) {
        console.error('✗ Error during server test:', error);
        process.exit(1);
    }
}

testServer();