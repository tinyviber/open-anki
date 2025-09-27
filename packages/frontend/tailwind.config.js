
module.exports = {
    purge: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
    theme: {
        extend: {
            colors: {
                'background': 'var(--background)',
                'foreground': 'var(--foreground)',
                'card': 'var(--card)',
                'card-foreground': 'var(--card-foreground)',
                'popover': 'var(--popover)',
                'popover-foreground': 'var(--popover-foreground)',
                'primary': 'var(--primary)',
                'primary-foreground': 'var(--primary-foreground)',
                'secondary': 'var(--secondary)',
                'secondary-foreground': 'var(--secondary-foreground)',
                'muted': 'var(--muted)',
                'muted-foreground': 'var(--muted-foreground)',
                'accent': 'var(--accent)',
                'accent-foreground': 'var(--accent-foreground)',
                'destructive': 'var(--destructive)',
                'destructive-foreground': 'var(--destructive-foreground)',

                // 边界、输入、环 (Ring) 和开关
                'border': 'var(--border)', // 解决 border-border 错误
                'input': 'var(--input)',
                'input-background': 'var(--input-background)',
                'switch-background': 'var(--switch-background)',
                'ring': 'var(--ring)',

                // Chart 颜色
                'chart-1': 'var(--chart-1)',
                'chart-2': 'var(--chart-2)',
                'chart-3': 'var(--chart-3)',
                'chart-4': 'var(--chart-4)',
                'chart-5': 'var(--chart-5)',

                // Sidebar 颜色
                'sidebar': 'var(--sidebar)',
                'sidebar-foreground': 'var(--sidebar-foreground)',
                'sidebar-primary': 'var(--sidebar-primary)',
                'sidebar-primary-foreground': 'var(--sidebar-primary-foreground)',
                'sidebar-accent': 'var(--sidebar-accent)',
                'sidebar-accent-foreground': 'var(--sidebar-accent-foreground)',
                'sidebar-border': 'var(--sidebar-border)',
                'sidebar-ring': 'var(--sidebar-ring)',
            },
            borderRadius: {
                'lg': 'var(--radius)',
                'md': 'calc(var(--radius) - 2px)',
                'sm': 'calc(var(--radius) - 4px)',
                'xl': 'calc(var(--radius) + 4px)',
            },
        },
    },
};
