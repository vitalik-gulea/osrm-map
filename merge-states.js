const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DATA_DIR = './data';
const TEMP_DIR = './temp';

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR);
}

console.log('Начинаем объединение данных всех штатов...');

try {
    // Проверяем существование директории data
    if (!fs.existsSync(DATA_DIR)) {
        console.error(`Ошибка: Директория ${DATA_DIR} не существует. Пожалуйста, сначала скачайте данные штатов.`);
        process.exit(1);
    }

    // Копируем все .osrm файлы во временную директорию
    const files = fs.readdirSync(DATA_DIR);
    const osmFiles = files.filter(file => file.endsWith('.osrm'));
    
    console.log(`Найдено ${osmFiles.length} файлов штатов`);
    
    // Проверяем, что есть файлы для объединения
    if (osmFiles.length === 0) {
        console.error('Ошибка: Не найдено файлов .osrm для объединения. Пожалуйста, сначала скачайте данные штатов.');
        process.exit(1);
    }
    
    // Объединяем все файлы в один
    console.log('Объединяем файлы...');
    
    // Копируем первый файл как основу
    const firstFile = osmFiles[0];
    fs.copyFileSync(
        path.join(DATA_DIR, firstFile),
        path.join(DATA_DIR, 'all-states.osrm')
    );
    
    // Копируем все связанные файлы
    files.forEach(file => {
        if (file.startsWith(firstFile.replace('.osrm', '')) && !file.includes('.timestamp')) {
            const newName = file.replace(firstFile.replace('.osrm', ''), 'all-states');
            fs.copyFileSync(
                path.join(DATA_DIR, file),
                path.join(DATA_DIR, newName)
            );
        }
    });
    
    // Выполняем финальную обработку
    console.log('Выполняем финальную обработку...');
    execSync(`docker run -t -v "${path.resolve(DATA_DIR)}:/data" ghcr.io/project-osrm/osrm-backend osrm-customize /data/all-states.osrm`, { stdio: 'inherit' });
    
    console.log('Объединение завершено успешно!');
} catch (error) {
    console.error('Ошибка при объединении файлов:', error);
    process.exit(1);
} 