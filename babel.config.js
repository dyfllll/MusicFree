module.exports = {
    presets: ['babel-preset-expo'],
    plugins: [
        [
            'module-resolver',
            {
                root: ['./'],
                alias: {
                    '^@/(.+)': './src/\\1',
                },
            },
        ],
        'react-native-reanimated/plugin',
        ["@babel/plugin-transform-class-static-block", { loose: true }],
    ],
    env: {
        production: {
            plugins: ['transform-remove-console'],
        },
    },
};
