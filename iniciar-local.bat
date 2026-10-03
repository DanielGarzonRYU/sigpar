@echo off
REM ============================================================
REM  SIGPAR - Servidor local de desarrollo
REM  Requisitos: XAMPP (PHP 8.2) y MySQL encendido.
REM  1. Copie .env.example como .env y ajuste DB_USER / DB_PASS
REM  2. Cree la base vacia:  CREATE DATABASE sigpar;
REM  3. Ejecute este archivo y abra http://localhost:8080
REM ============================================================
cd /d "%~dp0"
if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Se creo el archivo .env - revise los datos de conexion a MySQL.
)
set PHP=C:\xampp\php\php.exe
if not exist "%PHP%" set PHP=php
echo SIGPAR corriendo en http://localhost:8080  (Ctrl+C para detener)
start "" http://localhost:8080
"%PHP%" -S 0.0.0.0:8080 -t public dev-router.php
