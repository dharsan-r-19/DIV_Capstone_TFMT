CREATE DATABASE IF NOT EXISTS nova_bank;
USE nova_bank;

CREATE TABLE customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id VARCHAR(30) NULL UNIQUE,
  password_hash CHAR(128) NULL,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(120) NOT NULL UNIQUE,
  phone VARCHAR(20) NOT NULL,
  address TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  account_number VARCHAR(20) NOT NULL UNIQUE,
  account_type ENUM('Savings','Current','Salary') NOT NULL DEFAULT 'Savings',
  balance DECIMAL(14,2) NOT NULL DEFAULT 0,
  status ENUM('Active','Frozen','Closed') DEFAULT 'Active',
  opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  account_id INT NOT NULL,
  transaction_type ENUM('Deposit','Withdrawal','Transfer') NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  description VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE loans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  loan_type ENUM('Personal','Home','Auto','Education','Business') NOT NULL,
  principal DECIMAL(14,2) NOT NULL,
  interest_rate DECIMAL(5,2) NOT NULL,
  tenure_months INT NOT NULL,
  emi DECIMAL(14,2) NOT NULL,
  outstanding_balance DECIMAL(14,2) NOT NULL,
  status ENUM('Pending','Approved','Rejected','Closed') NOT NULL DEFAULT 'Pending',
  application_date DATE NOT NULL,
  approval_date DATE NULL,
  purpose VARCHAR(255),
  credit_score INT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE loan_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  loan_id INT NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  payment_date DATE NOT NULL,
  notes VARCHAR(255),
  FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE
);

INSERT INTO customers (full_name,email,phone,address) VALUES
('Aarav Sharma','aarav@example.com','9876543210','Mumbai, Maharashtra'),
('Meera Iyer','meera@example.com','9820145678','Bengaluru, Karnataka'),
('Rohan Patel','rohan@example.com','9898989898','Ahmedabad, Gujarat');
INSERT INTO accounts (customer_id,account_number,account_type,balance) VALUES
(1,'NV10024561','Savings',184500.00),(2,'NV10024562','Salary',72890.00),(3,'NV10024563','Current',315400.00);
INSERT INTO transactions (account_id,transaction_type,amount,description) VALUES
(1,'Deposit',25000,'Salary credit'),(2,'Withdrawal',5000,'ATM withdrawal'),(3,'Deposit',125000,'Business receipt');
INSERT INTO loans (customer_id,loan_type,principal,interest_rate,tenure_months,emi,outstanding_balance,status,application_date,approval_date,purpose,credit_score) VALUES
(1,'Home',4500000,8.45,240,38786.54,3984200,'Approved','2025-04-12','2025-04-18','Apartment purchase',782),
(2,'Education',800000,9.10,84,12939.61,612000,'Approved','2025-07-03','2025-07-08','Masters degree',746),
(3,'Business',1200000,12.50,60,26996.30,1200000,'Pending','2026-09-12',NULL,'Working capital',718);
