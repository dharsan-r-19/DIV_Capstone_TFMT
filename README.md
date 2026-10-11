# Nova Bank Management System

A full-stack banking-management project built with HTML, CSS and JavaScript on the frontend, Express/Node.js on the backend, and MySQL for persistent data. Nodemon is included for local development.

## Included modules

- Customer onboarding with automatic bank-account creation
- Savings, current and salary account types
- Deposits and withdrawals with balance protection and transaction audit history
- Operations dashboard for deposits, active customers, loans and recent activity
- Loan application workflow: Personal, Home, Auto, Education and Business loans
- Reducing-balance EMI calculation, credit score capture, approval/rejection controls
- Loan repayment posting, outstanding-balance tracking and automatic loan closure
- Responsive banking operations interface

## Run locally

1. Install MySQL and create the schema by running `database.sql` in MySQL Workbench or the MySQL command line.
2. Copy `.env.example` to `.env`, then set your MySQL password and database settings.
3. Install packages: `npm install`
4. Start development mode: `npm run dev`
5. Open `http://localhost:1234` for the customer portal or `http://localhost:1234/admin` for the administrator portal.

Use `npm start` to run without Nodemon.

## Customer portal

Customers sign in with their client ID and PIN, then can see only their own accounts, transaction history, loans, loan applications, transfers, and loan payments. Existing customers are assigned IDs such as `NVCLIENT0001` automatically on first server start; their initial PIN is `1234`. Change the PIN when creating real customer accounts before deploying this project.

Administrators sign in separately at `/admin`. The development credentials are administrator ID `admin` and PIN `1234`. Set `ADMIN_ID` and `ADMIN_PIN` in `.env` before deployment. Admin-only APIs and the operations console are protected, and the console includes the full customer directory.

## Loan details

Loan EMI is calculated with the standard amortization formula using monthly interest and the requested tenure. The system keeps the original principal, annual interest rate, tenure, calculated monthly EMI, status, credit score, purpose, approval date, outstanding balance, and payments. Only approved loans can accept repayments.
